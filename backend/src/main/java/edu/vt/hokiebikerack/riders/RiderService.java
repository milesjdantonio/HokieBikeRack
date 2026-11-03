package edu.vt.hokiebikerack.riders;

import edu.vt.hokiebikerack.audit.AuditService;
import edu.vt.hokiebikerack.common.ApiException;
import edu.vt.hokiebikerack.common.Db;
import edu.vt.hokiebikerack.common.Tokens;
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
  private final Clock clock;

  public RiderService(JdbcClient jdbc, AuditService audit, RackService racks, Clock clock) {
    this.jdbc = jdbc;
    this.audit = audit;
    this.racks = racks;
    this.clock = clock;
  }

  public record RiderCode(UUID riderId, String name, String code) {}

  public record Card(String label, boolean active) {}

  /** A rack where one of the rider's cards tapped in and hasn't tapped out. */
  public record Parked(UUID rackId, String rackName, String rackLocation, Instant since, boolean alarm,
                       boolean reported, Instant lastAlarmAt) {}

  public record RiderView(String name, List<Card> cards, List<Parked> parked) {}

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
    Map<String, Object> rider = jdbc.sql("SELECT id, name FROM riders WHERE code_hash = :hash")
        .param("hash", Tokens.sha256Hex(code)).query().listOfRows().stream().findFirst()
        .orElseThrow(() -> ApiException.notFound("Rider code"));
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
    return new RiderView((String) rider.get("name"), cards, parked);
  }
}
