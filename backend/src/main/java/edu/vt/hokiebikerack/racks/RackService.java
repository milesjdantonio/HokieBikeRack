package edu.vt.hokiebikerack.racks;

import com.fasterxml.jackson.databind.ObjectMapper;
import edu.vt.hokiebikerack.audit.AuditService;
import edu.vt.hokiebikerack.common.ApiException;
import edu.vt.hokiebikerack.common.Db;
import edu.vt.hokiebikerack.common.Tokens;
import edu.vt.hokiebikerack.config.HbrProperties;
import edu.vt.hokiebikerack.racks.RackModels.*;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Racks and the ESP32 devices attached to them. */
@Service
public class RackService {
  private final JdbcClient jdbc;
  private final ObjectMapper mapper;
  private final AuditService audit;
  private final Clock clock;
  private final Duration onlineWindow;

  public RackService(JdbcClient jdbc, ObjectMapper mapper, AuditService audit, Clock clock, HbrProperties props) {
    this.jdbc = jdbc;
    this.mapper = mapper;
    this.audit = audit;
    this.clock = clock;
    this.onlineWindow = props.deviceOnlineWindow();
  }

  // One query for all racks. The sub-selects count devices and recent alerts per rack.
  // "Open alerts" = MEDIUM or worse, not acknowledged, received in the last 24 h.
  private static final String RACK_SUMMARY_SQL = """
      SELECT r.id, r.name, r.location_description, r.created_at,
        (SELECT count(*) FROM devices d WHERE d.rack_id = r.id AND d.active) AS device_count,
        (SELECT count(*) FROM devices d WHERE d.rack_id = r.id AND d.active
            AND d.last_seen_at > :onlineSince) AS online_count,
        (SELECT max(d.last_seen_at) FROM devices d WHERE d.rack_id = r.id AND d.active) AS last_seen_at,
        (SELECT count(*) FROM security_events e WHERE e.rack_id = r.id
            AND e.severity IN ('MEDIUM','HIGH','CRITICAL') AND e.acknowledged_at IS NULL
            AND e.received_at > :alertSince) AS open_alerts,
        (SELECT coalesce(bool_or(
              coalesce((d.last_heartbeat->>'readerOk')::boolean, true) = false
           OR coalesce((d.last_heartbeat->>'accelOk')::boolean, true) = false), false)
         FROM devices d WHERE d.rack_id = r.id AND d.active AND d.last_seen_at > :onlineSince) AS sensor_fault
      FROM racks r
      """;

  /** Turns the numbers into one status word for the dashboard. */
  static String status(int deviceCount, int onlineCount, long openAlerts, boolean sensorFault) {
    if (deviceCount == 0) return "UNKNOWN";       // no device installed yet
    if (onlineCount == 0) return "OFFLINE";       // nobody heard from it recently
    if (openAlerts > 0 || sensorFault) return "WARNING";
    return "ONLINE";
  }

  private RackSummary mapSummary(ResultSet rs) throws SQLException {
    int devices = rs.getInt("device_count");
    int online = rs.getInt("online_count");
    long alerts = rs.getLong("open_alerts");
    boolean fault = rs.getBoolean("sensor_fault");
    return new RackSummary(Db.uuid(rs, "id"), rs.getString("name"), rs.getString("location_description"),
        status(devices, online, alerts, fault), devices, online, Db.instant(rs, "last_seen_at"), alerts, fault,
        Db.instant(rs, "created_at"));
  }

  private Map<String, Object> summaryParams() {
    Instant now = clock.instant();
    return Map.of("onlineSince", Db.ts(now.minus(onlineWindow)), "alertSince", Db.ts(now.minus(Duration.ofHours(24))));
  }

  public List<RackSummary> list() {
    return jdbc.sql(RACK_SUMMARY_SQL + " ORDER BY lower(r.name), r.created_at")
        .params(summaryParams()).query((rs, n) -> mapSummary(rs)).list();
  }

  public RackDetail get(UUID rackId) {
    RackSummary rack = jdbc.sql(RACK_SUMMARY_SQL + " WHERE r.id = :rackId")
        .params(summaryParams()).param("rackId", rackId)
        .query((rs, n) -> mapSummary(rs)).optional()
        .orElseThrow(() -> ApiException.notFound("Rack"));
    return new RackDetail(rack, devices(rackId));
  }

  private DeviceView mapDevice(ResultSet rs) throws SQLException {
    Instant lastSeen = Db.instant(rs, "last_seen_at");
    boolean active = rs.getBoolean("active");
    boolean online = active && lastSeen != null && lastSeen.isAfter(clock.instant().minus(onlineWindow));
    return new DeviceView(Db.uuid(rs, "id"), Db.uuid(rs, "rack_id"), rs.getString("device_label"),
        rs.getString("firmware_version"), lastSeen, online, active, rs.getLong("authorization_revision"),
        Db.json(mapper, rs, "last_heartbeat"), Db.instant(rs, "token_rotated_at"), Db.instant(rs, "created_at"));
  }

  private static final String DEVICE_SQL = """
      SELECT id, rack_id, device_label, firmware_version, last_seen_at, active, authorization_revision,
             last_heartbeat, token_rotated_at, created_at
      FROM devices
      """;

  public List<DeviceView> devices(UUID rackId) {
    return jdbc.sql(DEVICE_SQL + " WHERE rack_id = :rackId ORDER BY created_at")
        .param("rackId", rackId).query((rs, n) -> mapDevice(rs)).list();
  }

  private DeviceView device(UUID rackId, UUID deviceId) {
    return jdbc.sql(DEVICE_SQL + " WHERE id = :id AND rack_id = :rackId")
        .param("id", deviceId).param("rackId", rackId)
        .query((rs, n) -> mapDevice(rs)).optional()
        .orElseThrow(() -> ApiException.notFound("Device"));
  }

  @Transactional
  public RackDetail create(CreateRack req, String actor) {
    UUID id = UUID.randomUUID();
    jdbc.sql("""
            INSERT INTO racks (id, name, location_description, status)
            VALUES (:id, :name, :loc, 'UNKNOWN')
            """)
        .param("id", id).param("name", req.name().trim()).param("loc", blankToNull(req.locationDescription()))
        .update();
    audit.record(actor, "RACK_CREATED", "RACK", id, Map.of("name", req.name().trim()));
    return get(id);
  }

  @Transactional
  public RackDetail update(UUID rackId, UpdateRack req, String actor) {
    get(rackId);  // 404 if missing
    Map<String, Object> changes = new LinkedHashMap<>();
    if (req.name() != null) changes.put("name", req.name().trim());
    if (req.locationDescription() != null) changes.put("locationDescription", req.locationDescription().trim());
    jdbc.sql("""
            UPDATE racks SET
              name = COALESCE(:name, name),
              location_description = CASE WHEN :locSet THEN :loc ELSE location_description END,
              updated_at = :now
            WHERE id = :id
            """)
        .param("name", req.name() == null ? null : req.name().trim())
        .param("locSet", req.locationDescription() != null)
        .param("loc", blankToNull(req.locationDescription()))
        .param("now", Db.ts(clock.instant()))
        .param("id", rackId)
        .update();
    audit.record(actor, "RACK_UPDATED", "RACK", rackId, changes);
    return get(rackId);
  }

  /** Adds an ESP32 to a rack and creates its secret token (shown once). */
  @Transactional
  public DeviceCredentials addDevice(UUID rackId, CreateDevice req, String actor) {
    get(rackId);
    UUID id = UUID.randomUUID();
    String token = Tokens.newDeviceToken();
    jdbc.sql("""
            INSERT INTO devices (id, rack_id, device_label, token_hash, token_rotated_at)
            VALUES (:id, :rackId, :label, :hash, :now)
            """)
        .param("id", id).param("rackId", rackId).param("label", req.label().trim())
        .param("hash", Tokens.sha256Hex(token)).param("now", Db.ts(clock.instant()))
        .update();
    audit.record(actor, "DEVICE_ADDED", "DEVICE", id, Map.of("rackId", rackId.toString(), "label", req.label().trim()));
    return new DeviceCredentials(device(rackId, id), token, configSnippet(id, token));
  }

  /** New token; the old one stops working immediately. Use if a token leaked. */
  @Transactional
  public DeviceCredentials rotateToken(UUID rackId, UUID deviceId, String actor) {
    device(rackId, deviceId);
    String token = Tokens.newDeviceToken();
    jdbc.sql("UPDATE devices SET token_hash = :hash, token_rotated_at = :now WHERE id = :id")
        .param("hash", Tokens.sha256Hex(token)).param("now", Db.ts(clock.instant())).param("id", deviceId)
        .update();
    audit.record(actor, "DEVICE_TOKEN_ROTATED", "DEVICE", deviceId, Map.of("rackId", rackId.toString()));
    return new DeviceCredentials(device(rackId, deviceId), token, configSnippet(deviceId, token));
  }

  @Transactional
  public DeviceView updateDevice(UUID rackId, UUID deviceId, UpdateDevice req, String actor) {
    device(rackId, deviceId);
    jdbc.sql("""
            UPDATE devices SET device_label = COALESCE(:label, device_label), active = COALESCE(:active, active)
            WHERE id = :id
            """)
        .param("label", req.label() == null ? null : req.label().trim())
        .param("active", req.active())
        .param("id", deviceId)
        .update();
    Map<String, Object> changes = new LinkedHashMap<>();
    if (req.label() != null) changes.put("label", req.label().trim());
    if (req.active() != null) changes.put("active", req.active());
    audit.record(actor, "DEVICE_UPDATED", "DEVICE", deviceId, changes);
    return device(rackId, deviceId);
  }

  private static String configSnippet(UUID deviceId, String token) {
    return """
        // Paste into firmware/include/config.h (never commit that file)
        #define HBR_DEVICE_ID "%s"
        #define HBR_DEVICE_TOKEN "%s"
        // and set HBR_API_BASE_URL to this laptop, e.g. "http://<laptop-ip>:8080"
        """.formatted(deviceId, token);
  }

  private static String blankToNull(String s) {
    return s == null || s.isBlank() ? null : s.trim();
  }
}
