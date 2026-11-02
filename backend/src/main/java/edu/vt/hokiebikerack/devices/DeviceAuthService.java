package edu.vt.hokiebikerack.devices;

import edu.vt.hokiebikerack.common.Tokens;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;

/** Checks a device's bearer token against the stored hash. */
@Service
public class DeviceAuthService {
  private final JdbcClient jdbc;

  public DeviceAuthService(JdbcClient jdbc) {
    this.jdbc = jdbc;
  }

  private record Row(UUID id, UUID rackId, String tokenHash) {}

  /** Returns the device if `token` is the current token for `deviceId` and the device is active. */
  public Optional<DevicePrincipal> authenticate(UUID deviceId, String token) {
    if (token == null || token.isBlank()) return Optional.empty();
    Optional<Row> row = jdbc.sql("""
            SELECT id, rack_id, token_hash FROM devices
            WHERE id = :id AND active AND token_hash IS NOT NULL
            """)
        .param("id", deviceId)
        .query((rs, n) -> new Row(rs.getObject("id", UUID.class), rs.getObject("rack_id", UUID.class),
            rs.getString("token_hash")))
        .optional();
    return row.filter(r -> Tokens.constantTimeEquals(r.tokenHash(), Tokens.sha256Hex(token)))
        .map(r -> new DevicePrincipal(r.id(), r.rackId()));
  }
}
