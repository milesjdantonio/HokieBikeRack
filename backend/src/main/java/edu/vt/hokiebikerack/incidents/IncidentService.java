package edu.vt.hokiebikerack.incidents;

import com.fasterxml.jackson.databind.ObjectMapper;
import edu.vt.hokiebikerack.audit.AuditService;
import edu.vt.hokiebikerack.common.ApiException;
import edu.vt.hokiebikerack.common.Db;
import edu.vt.hokiebikerack.incidents.IncidentModels.*;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * "Alert Authorities": an admin or staff member reports a tamper alarm to the police, and the police
 * version moves the incident along. Nothing is sent outside this system yet (that would be a later
 * integration with VT Police dispatch); everything is recorded and audited.
 */
@Service
public class IncidentService {
  static final String AGENCY = "VT Police";

  private final JdbcClient jdbc;
  private final ObjectMapper mapper;
  private final AuditService audit;
  private final Clock clock;

  public IncidentService(JdbcClient jdbc, ObjectMapper mapper, AuditService audit, Clock clock) {
    this.jdbc = jdbc;
    this.mapper = mapper;
    this.audit = audit;
    this.clock = clock;
  }

  private static final String SELECT = """
      SELECT i.*, r.name AS rack_name, r.location_description, r.latitude, r.longitude
      FROM incidents i JOIN racks r ON r.id = i.rack_id
      """;

  private IncidentView map(ResultSet rs) throws SQLException {
    return new IncidentView(Db.uuid(rs, "id"), Db.uuid(rs, "rack_id"), rs.getString("rack_name"),
        rs.getString("location_description"), rs.getObject("latitude", Double.class),
        rs.getObject("longitude", Double.class), rs.getString("status"), rs.getString("agency"),
        rs.getString("alerted_by"), Db.instant(rs, "alerted_at"), rs.getString("note"),
        Db.instant(rs, "updated_at"), Db.instant(rs, "resolved_at"));
  }

  /** open = true: not resolved yet. open = false: everything, newest first (last 200). */
  public List<IncidentView> list(boolean open) {
    String where = open ? " WHERE i.status <> 'RESOLVED'" : "";
    return jdbc.sql(SELECT + where + " ORDER BY i.alerted_at DESC LIMIT 200").query((rs, n) -> map(rs)).list();
  }

  private IncidentView view(UUID id) {
    return jdbc.sql(SELECT + " WHERE i.id = :id").param("id", id).query((rs, n) -> map(rs)).optional()
        .orElseThrow(() -> ApiException.notFound("Incident"));
  }

  public IncidentDetail get(UUID id) {
    IncidentView incident = view(id);
    List<IncidentUpdate> updates = jdbc.sql("""
            SELECT status, note, actor, at FROM incident_updates WHERE incident_id = :id ORDER BY at, id
            """)
        .param("id", id)
        .query((rs, n) -> new IncidentUpdate(rs.getString("status"), rs.getString("note"), rs.getString("actor"),
            Db.instant(rs, "at")))
        .list();
    // What the rack itself reported from 30 min before the alert until it was resolved (or now).
    Instant from = incident.alertedAt().minus(Duration.ofMinutes(30));
    Instant to = incident.resolvedAt() != null ? incident.resolvedAt() : clock.instant();
    List<RackEvent> events = jdbc.sql("""
            SELECT id, event_type, severity, occurred_at, details FROM security_events
            WHERE rack_id = :rackId AND occurred_at BETWEEN :from AND :to
              AND event_type IN ('TAMPER_WARNING', 'TAMPER_ALARM', 'ACCESS_GRANTED', 'ACCESS_DENIED', 'DEVICE_BOOT')
            ORDER BY occurred_at LIMIT 100
            """)
        .param("rackId", incident.rackId()).param("from", Db.ts(from)).param("to", Db.ts(to))
        .query((rs, n) -> new RackEvent(Db.uuid(rs, "id"), rs.getString("event_type"), rs.getString("severity"),
            Db.instant(rs, "occurred_at"), Db.json(mapper, rs, "details")))
        .list();
    return new IncidentDetail(incident, updates, events);
  }

  @Transactional
  public IncidentDetail alert(UUID rackId, AlertAuthorities req, String actor) {
    boolean rackExists = jdbc.sql("SELECT count(*) FROM racks WHERE id = :id").param("id", rackId)
        .query(Long.class).single() > 0;
    if (!rackExists) throw ApiException.notFound("Rack");
    UUID id = UUID.randomUUID();
    Instant now = clock.instant();
    String note = blankToNull(req == null ? null : req.note());
    try {
      jdbc.sql("""
              INSERT INTO incidents (id, rack_id, status, agency, alerted_by, alerted_at, note, updated_at)
              VALUES (:id, :rackId, 'ALERTED', :agency, :actor, :now, :note, :now)
              """)
          .param("id", id).param("rackId", rackId).param("agency", AGENCY).param("actor", actor)
          .param("now", Db.ts(now)).param("note", note).update();
    } catch (DuplicateKeyException e) {
      throw ApiException.conflict(AGENCY + " were already alerted about this rack. Follow the open incident.");
    }
    addUpdate(id, "ALERTED", note, actor, now);
    Map<String, Object> details = new LinkedHashMap<>();
    details.put("rackId", rackId.toString());
    details.put("agency", AGENCY);
    if (note != null) details.put("note", note);
    audit.record(actor, "AUTHORITIES_ALERTED", "INCIDENT", id, details);
    return get(id);
  }

  @Transactional
  public IncidentDetail changeStatus(UUID id, ChangeStatus req, String actor) {
    IncidentView current = view(id);
    Status from = Status.valueOf(current.status());
    if (from == Status.RESOLVED) throw ApiException.conflict("This incident is already resolved.");
    if (req.status().ordinal() <= from.ordinal()) {
      throw ApiException.badRequest("An incident only moves forward: it is " + from + " now.");
    }
    Instant now = clock.instant();
    String note = blankToNull(req.note());
    jdbc.sql("""
            UPDATE incidents SET status = :status, updated_at = :now,
              resolved_at = CASE WHEN :status = 'RESOLVED' THEN :now ELSE resolved_at END
            WHERE id = :id
            """)
        .param("status", req.status().name()).param("now", Db.ts(now)).param("id", id).update();
    addUpdate(id, req.status().name(), note, actor, now);
    Map<String, Object> details = new LinkedHashMap<>();
    details.put("from", from.name());
    details.put("to", req.status().name());
    if (note != null) details.put("note", note);
    if (req.status() == Status.RESOLVED) {
      // Resolved by the police = the alarm is over (Miles): mark the rack's open shake/tamper alerts
      // handled, so its pin, panel and the rider page stop showing an alarm.
      int stopped = jdbc.sql("""
              UPDATE security_events SET acknowledged_at = :now, acknowledged_by = :actor
              WHERE rack_id = :rackId AND event_type IN ('TAMPER_WARNING', 'TAMPER_ALARM') AND acknowledged_at IS NULL
              """)
          .param("now", Db.ts(now)).param("actor", actor).param("rackId", current.rackId()).update();
      details.put("alarmsStopped", stopped);
    }
    audit.record(actor, "INCIDENT_" + req.status().name(), "INCIDENT", id, details);
    return get(id);
  }

  /**
   * Admin or staff marked the rack's alarm handled: that ends the issue, so the rack's open police
   * incident is resolved too. Otherwise the pin kept flashing and riders kept seeing "alarm" until
   * someone pressed Resolved in the police view. Returns true if an incident was open.
   */
  @Transactional
  public boolean resolveForRack(UUID rackId, String actor) {
    UUID open = jdbc.sql("SELECT id FROM incidents WHERE rack_id = :rackId AND status <> 'RESOLVED' LIMIT 1")
        .param("rackId", rackId).query(UUID.class).optional().orElse(null);
    if (open == null) return false;
    changeStatus(open, new ChangeStatus(Status.RESOLVED, "Marked handled by staff"), actor);
    return true;
  }

  private void addUpdate(UUID incidentId, String status, String note, String actor, Instant at) {
    jdbc.sql("INSERT INTO incident_updates (incident_id, status, note, actor, at) VALUES (:id, :status, :note, :actor, :at)")
        .param("id", incidentId).param("status", status).param("note", note).param("actor", actor)
        .param("at", Db.ts(at)).update();
  }

  private static String blankToNull(String s) {
    return s == null || s.isBlank() ? null : s.trim();
  }
}
