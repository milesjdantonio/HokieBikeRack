package edu.vt.hokiebikerack.credentials;

import edu.vt.hokiebikerack.audit.AuditService;
import edu.vt.hokiebikerack.common.ApiException;
import edu.vt.hokiebikerack.common.Db;
import edu.vt.hokiebikerack.credentials.CredentialModels.*;
import java.sql.Array;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Cards ("credentials") and which racks they may open.
 * Every change bumps the authorization revision so racks pick it up on their
 * next snapshot download (within ~60 s while online).
 */
@Service
public class CredentialService {
  private final JdbcClient jdbc;
  private final AuditService audit;
  private final AuthorizationRevision revision;
  private final Clock clock;

  public CredentialService(JdbcClient jdbc, AuditService audit, AuthorizationRevision revision, Clock clock) {
    this.jdbc = jdbc;
    this.audit = audit;
    this.revision = revision;
    this.clock = clock;
  }

  private static final String SELECT = """
      SELECT c.id, c.credential_reference, c.display_label, c.active, c.all_racks, c.valid_from,
             c.valid_until, c.created_at, c.updated_at, c.revoked_at,
             ARRAY(SELECT p.rack_id FROM credential_rack_permissions p WHERE p.credential_id = c.id
                   ORDER BY p.created_at) AS rack_ids,
             (SELECT max(e.occurred_at) FROM security_events e
               WHERE e.credential_reference = c.credential_reference AND e.event_type = 'ACCESS_GRANTED') AS last_used_at,
             (SELECT count(*) FROM security_events e
               WHERE e.credential_reference = c.credential_reference AND e.event_type = 'ACCESS_GRANTED') AS granted_count
      FROM credentials c
      """;

  private CredentialView map(ResultSet rs) throws SQLException {
    Instant now = clock.instant();
    boolean active = rs.getBoolean("active");
    Instant validFrom = Db.instant(rs, "valid_from");
    Instant validUntil = Db.instant(rs, "valid_until");
    Instant revokedAt = Db.instant(rs, "revoked_at");
    String status;
    if (revokedAt != null) status = "REVOKED";
    else if (!active) status = "DISABLED";
    else if (validUntil != null && !validUntil.isAfter(now)) status = "EXPIRED";
    else if (validFrom != null && validFrom.isAfter(now)) status = "NOT_YET_VALID";
    else status = "ACTIVE";
    Array arr = rs.getArray("rack_ids");
    List<UUID> rackIds = arr == null ? List.of() : Arrays.asList((UUID[]) arr.getArray());
    return new CredentialView(Db.uuid(rs, "id"), rs.getString("credential_reference"),
        rs.getString("display_label"), status, active, rs.getBoolean("all_racks"), rackIds, validFrom,
        validUntil, Db.instant(rs, "created_at"), Db.instant(rs, "updated_at"), revokedAt,
        Db.instant(rs, "last_used_at"), rs.getLong("granted_count"));
  }

  public List<CredentialView> list() {
    return jdbc.sql(SELECT + " ORDER BY lower(c.display_label), c.created_at").query((rs, n) -> map(rs)).list();
  }

  public CredentialView get(UUID id) {
    return jdbc.sql(SELECT + " WHERE c.id = :id").param("id", id).query((rs, n) -> map(rs)).optional()
        .orElseThrow(() -> ApiException.notFound("Credential"));
  }

  @Transactional
  public CredentialView create(CreateCredential req, String actor) {
    String ref = req.credentialReference().toLowerCase();
    checkDates(req.validFrom(), req.validUntil());
    boolean exists = jdbc.sql("SELECT count(*) FROM credentials WHERE credential_reference = :ref")
        .param("ref", ref).query(Long.class).single() > 0;
    if (exists) throw ApiException.conflict("That card is already registered");
    UUID id = UUID.randomUUID();
    Instant now = clock.instant();
    jdbc.sql("""
            INSERT INTO credentials (id, credential_reference, display_label, active, all_racks,
                valid_from, valid_until, created_at, updated_at)
            VALUES (:id, :ref, :label, TRUE, :all, :from, :until, :now, :now)
            """)
        .param("id", id).param("ref", ref).param("label", req.displayLabel().trim())
        .param("all", req.allRacks()).param("from", Db.ts(req.validFrom())).param("until", Db.ts(req.validUntil()))
        .param("now", Db.ts(now))
        .update();
    List<UUID> racks = setRacks(id, req.rackIds());
    long rev = revision.bump();
    Map<String, Object> details = new LinkedHashMap<>();
    details.put("label", req.displayLabel().trim());
    details.put("referencePrefix", ref.substring(0, 12));
    details.put("allRacks", req.allRacks());
    details.put("rackIds", racks.stream().map(UUID::toString).toList());
    details.put("revision", rev);
    audit.record(actor, "CREDENTIAL_CREATED", "CREDENTIAL", id, details);
    return get(id);
  }

  @Transactional
  public CredentialView update(UUID id, UpdateCredential req, String actor) {
    CredentialView before = get(id);
    if (before.revokedAt() != null && Boolean.TRUE.equals(req.active())) {
      throw ApiException.badRequest("A revoked card can't be re-enabled; register it again instead");
    }
    Instant from = Boolean.TRUE.equals(req.clearValidFrom()) ? null
        : (req.validFrom() != null ? req.validFrom() : before.validFrom());
    Instant until = Boolean.TRUE.equals(req.clearValidUntil()) ? null
        : (req.validUntil() != null ? req.validUntil() : before.validUntil());
    checkDates(from, until);
    jdbc.sql("""
            UPDATE credentials SET
              display_label = COALESCE(:label, display_label),
              active = COALESCE(:active, active),
              all_racks = COALESCE(:all, all_racks),
              valid_from = :from, valid_until = :until, updated_at = :now
            WHERE id = :id
            """)
        .param("label", req.displayLabel() == null ? null : req.displayLabel().trim())
        .param("active", req.active()).param("all", req.allRacks())
        .param("from", Db.ts(from)).param("until", Db.ts(until))
        .param("now", Db.ts(clock.instant())).param("id", id)
        .update();
    if (req.rackIds() != null) {
      jdbc.sql("DELETE FROM credential_rack_permissions WHERE credential_id = :id").param("id", id).update();
      setRacks(id, req.rackIds());
    }
    long rev = revision.bump();
    Map<String, Object> changes = new LinkedHashMap<>();
    if (req.displayLabel() != null) changes.put("label", req.displayLabel().trim());
    if (req.active() != null) changes.put("active", req.active());
    if (req.allRacks() != null) changes.put("allRacks", req.allRacks());
    if (req.rackIds() != null) changes.put("rackIds", req.rackIds().stream().map(UUID::toString).toList());
    if (req.validFrom() != null || Boolean.TRUE.equals(req.clearValidFrom())) changes.put("validFrom", String.valueOf(from));
    if (req.validUntil() != null || Boolean.TRUE.equals(req.clearValidUntil())) changes.put("validUntil", String.valueOf(until));
    changes.put("revision", rev);
    audit.record(actor, "CREDENTIAL_UPDATED", "CREDENTIAL", id, changes);
    return get(id);
  }

  /** Permanent: the card stops working at every rack (after their next sync). */
  @Transactional
  public CredentialView revoke(UUID id, String actor) {
    CredentialView before = get(id);
    if (before.revokedAt() != null) return before;
    Instant now = clock.instant();
    jdbc.sql("UPDATE credentials SET active = FALSE, revoked_at = :now, updated_at = :now WHERE id = :id")
        .param("now", Db.ts(now)).param("id", id).update();
    long rev = revision.bump();
    audit.record(actor, "CREDENTIAL_REVOKED", "CREDENTIAL", id,
        Map.of("label", before.displayLabel(), "revision", rev));
    return get(id);
  }

  /**
   * Cards that were tapped and denied, but aren't registered: the "tap, then
   * click Register" list. Only looks at the last 7 days.
   */
  public List<UnknownCard> unknownCards() {
    return jdbc.sql("""
            SELECT e.credential_reference,
                   max(e.occurred_at) AS last_seen_at,
                   count(*) AS attempts,
                   (array_agg(e.rack_id ORDER BY e.occurred_at DESC))[1] AS last_rack_id
            FROM security_events e
            WHERE e.event_type = 'ACCESS_DENIED'
              AND e.credential_reference IS NOT NULL
              AND e.received_at > :since
              AND NOT EXISTS (SELECT 1 FROM credentials c WHERE c.credential_reference = e.credential_reference)
            GROUP BY e.credential_reference
            ORDER BY last_seen_at DESC
            LIMIT 20
            """)
        .param("since", Db.ts(clock.instant().minus(Duration.ofDays(7))))
        .query((rs, n) -> {
          UUID rackId = Db.uuid(rs, "last_rack_id");
          String rackName = rackId == null ? null : jdbc.sql("SELECT name FROM racks WHERE id = :id")
              .param("id", rackId).query(String.class).optional().orElse(null);
          return new UnknownCard(rs.getString("credential_reference"), Db.instant(rs, "last_seen_at"),
              rs.getLong("attempts"), rackId, rackName);
        })
        .list();
  }

  private List<UUID> setRacks(UUID credentialId, List<UUID> rackIds) {
    if (rackIds == null || rackIds.isEmpty()) return List.of();
    List<UUID> unique = new ArrayList<>(new LinkedHashSet<>(rackIds));
    for (UUID rackId : unique) {
      long found = jdbc.sql("SELECT count(*) FROM racks WHERE id = :id").param("id", rackId).query(Long.class).single();
      if (found == 0) throw ApiException.badRequest("Unknown rack " + rackId);
      jdbc.sql("INSERT INTO credential_rack_permissions (credential_id, rack_id) VALUES (:c, :r)")
          .param("c", credentialId).param("r", rackId).update();
    }
    return unique;
  }

  private static void checkDates(Instant from, Instant until) {
    if (from != null && until != null && !until.isAfter(from)) {
      throw ApiException.badRequest("validUntil must be after validFrom");
    }
  }
}
