package edu.vt.hokiebikerack.credentials;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;

/**
 * The authorization revision: a number that goes up whenever who-may-unlock-what changes.
 * Racks refuse any card list with a lower revision than the one they have
 * (so an attacker can't replay an old list that still includes a revoked card).
 */
@Service
public class AuthorizationRevision {
  private final JdbcClient jdbc;

  public AuthorizationRevision(JdbcClient jdbc) {
    this.jdbc = jdbc;
  }

  public long current() {
    return jdbc.sql("SELECT revision FROM authorization_state WHERE id = 1").query(Long.class).single();
  }

  /**
   * Bump it. GREATEST(old + 1, now-in-ms) means: always bigger than before,
   * and roughly the current time, so even a freshly wiped database starts
   * above whatever a rack remembers from before.
   */
  public long bump() {
    return jdbc.sql("""
            UPDATE authorization_state
            SET revision = GREATEST(revision + 1, (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::BIGINT)
            WHERE id = 1
            RETURNING revision
            """)
        .query(Long.class).single();
  }
}
