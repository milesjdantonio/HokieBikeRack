package edu.vt.hokiebikerack.audit;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import edu.vt.hokiebikerack.common.Db;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;

/** Writes and reads the admin audit log ("who changed what, when"). */
@Service
public class AuditService {
  private final JdbcClient jdbc;
  private final ObjectMapper mapper;

  public AuditService(JdbcClient jdbc, ObjectMapper mapper) {
    this.jdbc = jdbc;
    this.mapper = mapper;
  }

  /** One audit log line. */
  public record AuditEntry(long id, String actor, String action, String targetType, String targetId,
                           JsonNode details, Instant createdAt) {}

  /** One page of the audit log, with the total for paging. */
  public record AuditPage(List<AuditEntry> items, int page, int size, long total) {}

  /** Call inside the same transaction as the change, so both happen or neither does. */
  public void record(String actor, String action, String targetType, Object targetId, Map<String, ?> details) {
    jdbc.sql("""
            INSERT INTO admin_audit_log (actor, action, target_type, target_id, details)
            VALUES (:actor, :action, :type, :target, CAST(:details AS jsonb))
            """)
        .param("actor", actor)
        .param("action", action)
        .param("type", targetType)
        .param("target", targetId == null ? null : targetId.toString())
        .param("details", Db.toJson(mapper, details == null ? Map.of() : details))
        .update();
  }

  /** One page of the audit log, newest first, with the total count for paging. */
  public AuditPage list(int page, int size) {
    List<AuditEntry> items = jdbc.sql("""
            SELECT id, actor, action, target_type, target_id, details, created_at
            FROM admin_audit_log ORDER BY created_at DESC, id DESC
            LIMIT :limit OFFSET :offset
            """)
        .param("limit", size)
        .param("offset", (long) page * size)
        .query((rs, n) -> new AuditEntry(rs.getLong("id"), rs.getString("actor"), rs.getString("action"),
            rs.getString("target_type"), rs.getString("target_id"), Db.json(mapper, rs, "details"),
            Db.instant(rs, "created_at")))
        .list();
    long total = jdbc.sql("SELECT count(*) FROM admin_audit_log").query(Long.class).single();
    return new AuditPage(items, page, size, total);
  }
}
