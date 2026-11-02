package edu.vt.hokiebikerack.devices;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import edu.vt.hokiebikerack.common.ApiException;
import edu.vt.hokiebikerack.common.Db;
import edu.vt.hokiebikerack.config.HbrProperties;
import edu.vt.hokiebikerack.credentials.AuthorizationRevision;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;

/** Device-side logic: the card-list snapshot and heartbeats. */
@Service
public class DeviceService {
  private static final Logger log = LoggerFactory.getLogger(DeviceService.class);
  // Must match kMaxSnapshotRefs in firmware/lib/hbr_logic/src/access_rules.h.
  static final int MAX_SNAPSHOT_REFS = 500;
  private static final int MAX_HEARTBEAT_BYTES = 4096;

  private final JdbcClient jdbc;
  private final ObjectMapper mapper;
  private final AuthorizationRevision revision;
  private final Clock clock;
  private final Duration validity;

  public DeviceService(JdbcClient jdbc, ObjectMapper mapper, AuthorizationRevision revision, Clock clock,
                       HbrProperties props) {
    this.jdbc = jdbc;
    this.mapper = mapper;
    this.revision = revision;
    this.clock = clock;
    this.validity = props.snapshotValidity();
  }

  /**
   * What the rack downloads. Epoch numbers are for the ESP32 (no date parsing
   * needed); the ISO strings are for humans reading it.
   */
  public record Snapshot(UUID deviceId, UUID rackId, long revision, Instant issuedAt, long issuedAtEpoch,
                         Instant validUntil, long validUntilEpoch, int credentialCount,
                         List<String> credentialReferences) {}

  public void touch(DevicePrincipal device) {
    jdbc.sql("UPDATE devices SET last_seen_at = :now WHERE id = :id")
        .param("now", Db.ts(clock.instant())).param("id", device.deviceId()).update();
  }

  public Snapshot snapshot(DevicePrincipal device) {
    Instant now = clock.instant();
    long rev = revision.current();  // read first: if it changes during the query, the next fetch catches it
    // Allowed = active, not revoked, inside its valid-from/until dates, and
    // either "all racks" or given this rack specifically.
    List<String> refs = jdbc.sql("""
            SELECT c.credential_reference FROM credentials c
            WHERE c.active AND c.revoked_at IS NULL
              AND (c.valid_from IS NULL OR c.valid_from <= :now)
              AND (c.valid_until IS NULL OR c.valid_until > :now)
              AND (c.all_racks OR EXISTS (
                    SELECT 1 FROM credential_rack_permissions p
                    WHERE p.credential_id = c.id AND p.rack_id = :rackId))
            ORDER BY c.credential_reference
            LIMIT :limit
            """)
        .param("now", Db.ts(now)).param("rackId", device.rackId()).param("limit", MAX_SNAPSHOT_REFS + 1)
        .query(String.class).list();
    if (refs.size() > MAX_SNAPSHOT_REFS) {
      log.error("Rack {} has more than {} allowed cards; the firmware can't hold them all", device.rackId(),
          MAX_SNAPSHOT_REFS);
      throw new ApiException(org.springframework.http.HttpStatus.INSUFFICIENT_STORAGE,
          "too many credentials for one rack");
    }
    Instant issuedAt = now.truncatedTo(java.time.temporal.ChronoUnit.SECONDS);
    Instant validUntil = issuedAt.plus(validity);
    return new Snapshot(device.deviceId(), device.rackId(), rev, issuedAt, issuedAt.getEpochSecond(),
        validUntil, validUntil.getEpochSecond(), refs.size(), refs);
  }

  public Map<String, Object> heartbeat(DevicePrincipal device, JsonNode body) {
    if (body == null || !body.isObject()) throw ApiException.badRequest("heartbeat must be a JSON object");
    String json = Db.toJson(mapper, body);
    if (json.length() > MAX_HEARTBEAT_BYTES) throw ApiException.badRequest("heartbeat too large");
    String fw = body.path("firmwareVersion").asText(null);
    if (fw != null && fw.length() > 80) fw = fw.substring(0, 80);
    long snapshotRevision = body.path("snapshotRevision").asLong(0);
    Instant now = clock.instant();
    jdbc.sql("""
            UPDATE devices SET last_seen_at = :now, last_heartbeat = CAST(:hb AS jsonb),
              firmware_version = COALESCE(:fw, firmware_version),
              authorization_revision = GREATEST(:rev, 0)
            WHERE id = :id
            """)
        .param("now", Db.ts(now)).param("hb", json).param("fw", fw).param("rev", snapshotRevision)
        .param("id", device.deviceId())
        .update();
    return Map.of("serverTime", now.toString(), "currentRevision", revision.current());
  }
}
