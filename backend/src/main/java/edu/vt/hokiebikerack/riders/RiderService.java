package edu.vt.hokiebikerack.riders;

import edu.vt.hokiebikerack.audit.AuditService;
import edu.vt.hokiebikerack.common.ApiException;
import edu.vt.hokiebikerack.common.Db;
import edu.vt.hokiebikerack.common.Tokens;
import edu.vt.hokiebikerack.credentials.CredentialModels.CreateCredential;
import edu.vt.hokiebikerack.credentials.CredentialService;
import edu.vt.hokiebikerack.events.EventService.CardRefused;
import org.springframework.context.event.EventListener;
import edu.vt.hokiebikerack.racks.RackService;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Riders: the person behind a card. The rider app identifies a rider by a private code (no password
 * in the demo), shows where their bike is parked (tap in / tap out, like open spots) and warns them
 * when that rack has an alarm or a police report.
 */
@Service
public class RiderService {
  // No 0/O, 1/I/L: easy to read out loud and type.
  private static final String ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  private static final SecureRandom RANDOM = new SecureRandom();

  private final JdbcClient jdbc;
  private final AuditService audit;
  private final RackService racks;
  private final CredentialService credentials;
  private final Clock clock;
  static final Duration LINK_WINDOW = Duration.ofMinutes(2);

  public RiderService(JdbcClient jdbc, AuditService audit, RackService racks, CredentialService credentials, Clock clock) {
    this.jdbc = jdbc;
    this.audit = audit;
    this.racks = racks;
    this.credentials = credentials;
    this.clock = clock;
  }

  /** A rider's access request as staff see it. */
  public record AccessRequest(UUID id, String name, String email, String hokiePassportId, String note, String status,
                              Instant requestedAt, Instant decidedAt, String decidedBy) {}

  /** What the request form gets back: the rider's private code and PENDING. */
  public record RequestResult(String code, String status) {}

  /** A newly made rider code (shown once). */
  public record RiderCode(UUID riderId, String name, String code) {}

  /** One of the rider's cards. */
  public record Card(String label, boolean active) {}

  /** A rack where one of the rider's cards tapped in and hasn't tapped out. */
  public record Parked(UUID rackId, String rackName, String rackLocation, Instant since, boolean alarm,
                       boolean reported, Instant lastAlarmAt) {}

  /** status: PENDING (waiting for staff), APPROVED, DENIED. linkUntil: the HokieP link window, if open. */
  public record RiderView(String name, String status, List<Card> cards, List<Parked> parked, Instant linkUntil) {}

  /** A private rider code like "K7QM-3XPA" (no look-alike letters), the rider's key to the app. */
  static String newCode() {
    StringBuilder sb = new StringBuilder();
    for (int i = 0; i < 8; i++) {
      if (i == 4) sb.append('-');
      sb.append(ALPHABET.charAt(RANDOM.nextInt(ALPHABET.length())));
    }
    return sb.toString();
  }

  /** "k7p2 qm4x" -> "K7P2-QM4X", so typing it loosely still works. */
  static String normalize(String code) {
    String s = code == null ? "" : code.toUpperCase().replaceAll("[^A-Z0-9]", "");
    return s.length() == 8 ? s.substring(0, 4) + "-" + s.substring(4) : s;
  }

  /**
   * Gives the card's rider a new code (making the rider if the card has none yet). The code is
   * returned ONCE; only its hash is kept.
   */
  @Transactional
  public RiderCode issueCode(UUID credentialId, String name, String actor) {
    Map<String, Object> card = jdbc.sql("SELECT display_label, rider_id FROM credentials WHERE id = :id")
        .param("id", credentialId).query().listOfRows().stream().findFirst()
        .orElseThrow(() -> ApiException.notFound("Card"));
    String riderName = name != null && !name.isBlank() ? name.trim() : (String) card.get("display_label");
    if (riderName == null || riderName.isBlank()) riderName = "Rider";
    String code = newCode();
    String hash = Tokens.sha256Hex(code);
    Instant now = clock.instant();
    UUID riderId = (UUID) card.get("rider_id");
    if (riderId == null) {
      riderId = UUID.randomUUID();
      jdbc.sql("INSERT INTO riders (id, name, code_hash, created_at) VALUES (:id, :name, :hash, :now)")
          .param("id", riderId).param("name", riderName).param("hash", hash).param("now", Db.ts(now)).update();
      jdbc.sql("UPDATE credentials SET rider_id = :rider WHERE id = :id").param("rider", riderId).param("id", credentialId).update();
    } else {
      jdbc.sql("UPDATE riders SET name = :name, code_hash = :hash, code_rotated_at = :now WHERE id = :id")
          .param("name", riderName).param("hash", hash).param("now", Db.ts(now)).param("id", riderId).update();
    }
    audit.record(actor, "RIDER_CODE_ISSUED", "RIDER", riderId, Map.of("name", riderName, "credentialId", credentialId.toString()));
    return new RiderCode(riderId, riderName, code);
  }

  /** What the rider app shows for a code. 404 if the code doesn't match anyone. */
  public RiderView me(String rawCode) {
    String code = normalize(rawCode);
    if (code.length() != 9) throw ApiException.notFound("Rider code");
    Map<String, Object> rider = findByCode(rawCode);
    UUID riderId = (UUID) rider.get("id");
    List<Card> cards = jdbc.sql("""
            SELECT display_label, active AND revoked_at IS NULL AS usable FROM credentials
            WHERE rider_id = :id ORDER BY created_at
            """)
        .param("id", riderId)
        .query((rs, n) -> new Card(rs.getString("display_label"), rs.getBoolean("usable"))).list();
    // Parked = this rider's card has an odd number of unlocks at a rack (tap in, tap out) since the
    // rack's spots were last reset, within a week. Same rule as the rack's open spots.
    Instant now = clock.instant();
    List<Map<String, Object>> rows = jdbc.sql("""
            SELECT e.rack_id, max(e.occurred_at) AS since
            FROM security_events e
            JOIN credentials c ON c.credential_reference = e.credential_reference
            JOIN racks r ON r.id = e.rack_id
            WHERE c.rider_id = :id AND e.event_type = 'ACCESS_GRANTED'
              AND e.occurred_at > GREATEST(COALESCE(r.spots_reset_at, :since), :since)
            GROUP BY e.rack_id, e.credential_reference
            HAVING count(*) % 2 = 1
            ORDER BY since DESC
            """)
        .param("id", riderId).param("since", Db.ts(now.minus(Duration.ofDays(7)))).query().listOfRows();
    List<Parked> parked = rows.stream().map((row) -> {
      var rack = racks.get((UUID) row.get("rack_id")).rack();
      Object since = row.get("since");
      Instant sinceAt = since instanceof java.sql.Timestamp t ? t.toInstant()
          : since instanceof java.time.OffsetDateTime o ? o.toInstant() : null;
      return new Parked(rack.id(), rack.name(), rack.locationDescription(), sinceAt, rack.openAlarms() > 0,
          rack.incidentStatus() != null, rack.lastAlarmAt());
    }).toList();
    Instant linkUntil = toInstant(rider.get("link_until"));
    if (linkUntil != null && !linkUntil.isAfter(now)) linkUntil = null;
    return new RiderView((String) rider.get("name"), (String) rider.get("status"), cards, parked, linkUntil);
  }

  private Map<String, Object> findByCode(String rawCode) {
    String code = normalize(rawCode);
    if (code.length() != 9) throw ApiException.notFound("Rider code");
    return jdbc.sql("SELECT id, name, status, link_until FROM riders WHERE code_hash = :hash")
        .param("hash", Tokens.sha256Hex(code)).query().listOfRows().stream().findFirst()
        .orElseThrow(() -> ApiException.notFound("Rider code"));
  }

  private static Instant toInstant(Object v) {
    return v instanceof java.sql.Timestamp t ? t.toInstant() : v instanceof java.time.OffsetDateTime o ? o.toInstant() : null;
  }

  // ---------- requests (the stand-in for a StarRez form) ----------

  /** A rider asks for access online. Returns their private code (the phone keeps it). */
  @Transactional
  public RequestResult request(String name, String email, String hokieId, String note) {
    UUID id = UUID.randomUUID();
    String code = newCode();
    jdbc.sql("""
            INSERT INTO riders (id, name, code_hash, status, email, hokie_passport_id, note, created_at)
            VALUES (:id, :name, :hash, 'PENDING', :email, :hokie, :note, :now)
            """)
        .param("id", id).param("name", name.trim()).param("hash", Tokens.sha256Hex(code))
        .param("email", email.trim().toLowerCase()).param("hokie", hokieId == null ? null : hokieId.trim())
        .param("note", note == null || note.isBlank() ? null : note.trim()).param("now", Db.ts(clock.instant())).update();
    audit.record("rider:" + name.trim(), "ACCESS_REQUESTED", "RIDER", id, Map.of("email", email.trim().toLowerCase()));
    return new RequestResult(code, "PENDING");
  }

  /** Access requests, newest first; `status` filters (PENDING, APPROVED, DENIED). */
  public List<AccessRequest> requests(String status) {
    String where = status == null || status.isBlank() ? "" : " WHERE status = :status";
    var q = jdbc.sql("""
            SELECT id, name, email, hokie_passport_id, note, status, created_at, decided_at, decided_by FROM riders
            """ + where + " ORDER BY created_at DESC LIMIT 200");
    if (!where.isEmpty()) q = q.param("status", status.toUpperCase());
    return q.query((rs, n) -> new AccessRequest(Db.uuid(rs, "id"), rs.getString("name"), rs.getString("email"),
        rs.getString("hokie_passport_id"), rs.getString("note"), rs.getString("status"), Db.instant(rs, "created_at"),
        Db.instant(rs, "decided_at"), rs.getString("decided_by"))).list();
  }

  /** Approves or denies a PENDING request. 409 if it was already decided. */
  @Transactional
  public AccessRequest decide(UUID riderId, boolean approve, String actor) {
    int n = jdbc.sql("""
            UPDATE riders SET status = :status, decided_at = :now, decided_by = :actor
            WHERE id = :id AND status = 'PENDING'
            """)
        .param("status", approve ? "APPROVED" : "DENIED").param("now", Db.ts(clock.instant()))
        .param("actor", actor).param("id", riderId).update();
    if (n == 0) throw ApiException.conflict("That request was already decided (or doesn't exist).");
    audit.record(actor, approve ? "ACCESS_APPROVED" : "ACCESS_DENIED", "RIDER", riderId, Map.of());
    return requests(null).stream().filter((r) -> r.id().equals(riderId)).findFirst().orElseThrow();
  }

  /** Opens a 2-minute window: the next unknown card tapped on any rack becomes this rider's HokieP. */
  @Transactional
  public RiderView startLink(String rawCode) {
    Map<String, Object> rider = findByCode(rawCode);
    if (!"APPROVED".equals(rider.get("status"))) throw ApiException.conflict("Your request hasn't been approved yet.");
    jdbc.sql("UPDATE riders SET link_until = :until WHERE id = :id")
        .param("until", Db.ts(clock.instant().plus(LINK_WINDOW))).param("id", rider.get("id")).update();
    return me(rawCode);
  }

  /**
   * A rack refused an unknown card. If exactly one approved rider is waiting to link, that card is
   * theirs: register it for all racks under their name. (Two riders linking in the same 2 minutes is
   * ambiguous, so nothing happens and they try again.)
   */
  @EventListener
  public void onCardRefused(CardRefused tap) {
    boolean known = jdbc.sql("SELECT count(*) FROM credentials WHERE credential_reference = :ref")
        .param("ref", tap.credentialReference()).query(Long.class).single() > 0;
    if (known) return;
    List<Map<String, Object>> waiting = jdbc.sql("""
            SELECT id, name FROM riders WHERE status = 'APPROVED' AND link_until > :now ORDER BY link_until DESC
            """)
        .param("now", Db.ts(clock.instant())).query().listOfRows();
    if (waiting.size() != 1) return;
    UUID riderId = (UUID) waiting.get(0).get("id");
    String name = (String) waiting.get(0).get("name");
    var card = credentials.create(new CreateCredential(tap.credentialReference(), name + "'s HokieP", true, List.of(), null, null),
        "rider:" + name);
    jdbc.sql("UPDATE credentials SET rider_id = :rider WHERE id = :id").param("rider", riderId).param("id", card.id()).update();
    jdbc.sql("UPDATE riders SET link_until = NULL WHERE id = :id").param("id", riderId).update();
    audit.record("rider:" + name, "HOKIEP_LINKED", "RIDER", riderId,
        Map.of("credentialId", card.id().toString(), "rackId", String.valueOf(tap.rackId())));
  }
}
