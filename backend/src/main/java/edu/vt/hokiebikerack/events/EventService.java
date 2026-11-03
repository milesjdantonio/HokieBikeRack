package edu.vt.hokiebikerack.events;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import edu.vt.hokiebikerack.audit.AuditService;
import edu.vt.hokiebikerack.common.ApiException;
import edu.vt.hokiebikerack.common.Db;
import edu.vt.hokiebikerack.devices.DevicePrincipal;
import edu.vt.hokiebikerack.events.EventModels.*;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Pattern;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Storing device events and searching them. */
@Service
public class EventService {
  private static final Pattern CREDENTIAL_REF = Pattern.compile("^[0-9a-f]{64}$");
  private static final int MAX_DETAILS_BYTES = 4096;
  // Device clocks can be wrong. Trust them only within this range of our clock.
  private static final Duration MAX_FUTURE_SKEW = Duration.ofMinutes(5);
  private static final Duration MAX_PAST_AGE = Duration.ofDays(30);

  private final JdbcClient jdbc;
  private final ObjectMapper mapper;
  private final AuditService audit;
  private final Clock clock;
  private final org.springframework.context.ApplicationEventPublisher publisher;

  /** Published for every NEW refused tap of a card; riders use it to link a Hokie Passport. */
  public record CardRefused(String credentialReference, java.util.UUID rackId) {}

  public EventService(JdbcClient jdbc, ObjectMapper mapper, AuditService audit, Clock clock,
                      org.springframework.context.ApplicationEventPublisher publisher) {
    this.jdbc = jdbc;
    this.mapper = mapper;
    this.audit = audit;
    this.clock = clock;
    this.publisher = publisher;
  }

  /**
   * Store a batch from a device. IDEMPOTENT: sending the same batch twice
   * stores each event once. That's what makes the firmware's "retry until it
   * works" safe. The trick is "ON CONFLICT (id) DO NOTHING": the database
   * itself refuses a second row with the same primary key, even if two
   * uploads race each other.
   */
  @Transactional
  public IngestResult ingest(DevicePrincipal device, List<DeviceEvent> events) {
    Instant now = clock.instant();
    int accepted = 0;
    for (DeviceEvent e : events) {
      if (e.details() != null && !e.details().isObject() && !e.details().isNull()) {
        throw ApiException.badRequest("event " + e.id() + ": details must be a JSON object");
      }
      ObjectNode details = e.details() != null && e.details().isObject()
          ? ((ObjectNode) e.details()).deepCopy() : mapper.createObjectNode();
      if (e.uptimeMs() != null) details.put("uptimeMs", e.uptimeMs());
      String detailsJson = Db.toJson(mapper, details);
      if (detailsJson.length() > MAX_DETAILS_BYTES) {
        throw ApiException.badRequest("event " + e.id() + ": details too large");
      }

      boolean trustDeviceTime = e.occurredAt() != null
          && !e.occurredAt().isAfter(now.plus(MAX_FUTURE_SKEW))
          && !e.occurredAt().isBefore(now.minus(MAX_PAST_AGE));
      Instant occurredAt = trustDeviceTime ? e.occurredAt() : now;

      String ref = details.path("credentialReference").asText(null);
      if (ref != null && !CREDENTIAL_REF.matcher(ref).matches()) ref = null;

      int stored = jdbc.sql("""
              INSERT INTO security_events (id, device_id, rack_id, event_type, severity, occurred_at,
                  received_at, details, credential_reference, time_source, firmware_version)
              VALUES (:id, :deviceId, :rackId, :type, :severity, :occurredAt, :receivedAt,
                  CAST(:details AS jsonb), :ref, :timeSource, :fw)
              ON CONFLICT (id) DO NOTHING
              """)
          .param("id", e.id())
          .param("deviceId", device.deviceId())
          .param("rackId", device.rackId())
          .param("type", e.eventType())
          .param("severity", e.severity().name())
          .param("occurredAt", Db.ts(occurredAt))
          .param("receivedAt", Db.ts(now))
          .param("details", detailsJson)
          .param("ref", ref)
          .param("timeSource", trustDeviceTime ? "DEVICE" : "SERVER")
          .param("fw", e.firmwareVersion())
          .update();
      accepted += stored;
      if (stored == 1 && ref != null && "ACCESS_DENIED".equals(e.eventType())) {
        publisher.publishEvent(new CardRefused(ref, device.rackId()));
      }
    }
    return new IngestResult(accepted, events.size() - accepted);
  }

  private static final String EVENT_SELECT = """
      SELECT e.id, e.occurred_at, e.received_at, e.time_source, e.rack_id, r.name AS rack_name,
             e.device_id, d.device_label, e.event_type, e.severity, e.details,
             e.credential_reference, c.id AS credential_id, c.display_label AS credential_label,
             e.acknowledged_at, e.acknowledged_by
      FROM security_events e
      LEFT JOIN racks r ON r.id = e.rack_id
      LEFT JOIN devices d ON d.id = e.device_id
      LEFT JOIN credentials c ON c.credential_reference = e.credential_reference
      """;

  private EventView map(ResultSet rs) throws SQLException {
    JsonNode details = Db.json(mapper, rs, "details");
    boolean simulated = details != null && details.path("simulated").asBoolean(false);
    return new EventView(Db.uuid(rs, "id"), Db.instant(rs, "occurred_at"), Db.instant(rs, "received_at"),
        rs.getString("time_source"), Db.uuid(rs, "rack_id"), rs.getString("rack_name"),
        Db.uuid(rs, "device_id"), rs.getString("device_label"), rs.getString("event_type"),
        rs.getString("severity"), details, rs.getString("credential_reference"),
        Db.uuid(rs, "credential_id"), rs.getString("credential_label"),
        Db.instant(rs, "acknowledged_at"), rs.getString("acknowledged_by"), simulated);
  }

  /** Search with optional filters. Builds the WHERE clause only from filters that were given. */
  public EventPage search(EventFilter f, int page, int size) {
    StringBuilder where = new StringBuilder(" WHERE TRUE");
    Map<String, Object> params = new HashMap<>();
    if (f.rackId() != null) { where.append(" AND e.rack_id = :rackId"); params.put("rackId", f.rackId()); }
    if (f.severity() != null) {
      where.append(" AND e.severity = :severity");
      params.put("severity", f.severity().toUpperCase());
    }
    if (f.eventType() != null) {
      // "TAMPER" matches TAMPER_WARNING and TAMPER_ALARM.
      where.append(" AND e.event_type LIKE :type");
      params.put("type", f.eventType().toUpperCase().replaceAll("[^A-Z0-9_]", "") + "%");
    }
    if (f.credentialReference() != null) {
      where.append(" AND e.credential_reference = :ref");
      params.put("ref", f.credentialReference().toLowerCase());
    }
    if (f.from() != null) { where.append(" AND e.occurred_at >= :from"); params.put("from", Db.ts(f.from())); }
    if (f.to() != null) { where.append(" AND e.occurred_at < :to"); params.put("to", Db.ts(f.to())); }
    if (Boolean.TRUE.equals(f.unacknowledgedOnly())) where.append(" AND e.acknowledged_at IS NULL");

    params.put("limit", size);
    params.put("offset", (long) page * size);
    List<EventView> items = jdbc.sql(EVENT_SELECT + where + " ORDER BY e.occurred_at DESC, e.received_at DESC"
            + " LIMIT :limit OFFSET :offset")
        .params(params).query((rs, n) -> map(rs)).list();
    long total = jdbc.sql("SELECT count(*) FROM security_events e" + where)
        .params(params).query(Long.class).single();
    return new EventPage(items, page, size, total);
  }

  /** Mark an alert as "seen / dealt with". It stops counting toward the rack's WARNING status. */
  @Transactional
  public EventView acknowledge(UUID eventId, String actor) {
    int changed = jdbc.sql("""
            UPDATE security_events SET acknowledged_at = :now, acknowledged_by = :actor
            WHERE id = :id AND acknowledged_at IS NULL
            """)
        .param("now", Db.ts(clock.instant())).param("actor", actor).param("id", eventId)
        .update();
    EventView view = jdbc.sql(EVENT_SELECT + " WHERE e.id = :id").param("id", eventId)
        .query((rs, n) -> map(rs)).optional()
        .orElseThrow(() -> ApiException.notFound("Event"));
    if (changed > 0) audit.record(actor, "EVENT_ACKNOWLEDGED", "EVENT", eventId, Map.of("eventType", view.eventType()));
    return view;
  }

  @Transactional
  public int acknowledgeAllForRack(UUID rackId, String actor) {
    int changed = jdbc.sql("""
            UPDATE security_events SET acknowledged_at = :now, acknowledged_by = :actor
            WHERE rack_id = :rackId AND acknowledged_at IS NULL AND severity IN ('MEDIUM','HIGH','CRITICAL')
            """)
        .param("now", Db.ts(clock.instant())).param("actor", actor).param("rackId", rackId)
        .update();
    if (changed > 0) audit.record(actor, "RACK_ALERTS_ACKNOWLEDGED", "RACK", rackId, Map.of("count", changed));
    return changed;
  }
}
