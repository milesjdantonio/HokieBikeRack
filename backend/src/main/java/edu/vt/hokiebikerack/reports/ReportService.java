package edu.vt.hokiebikerack.reports;

import edu.vt.hokiebikerack.common.Db;
import edu.vt.hokiebikerack.config.HbrProperties;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;

/** Summary numbers for the Reports page. All counting is done in SQL (GROUP BY). */
@Service
public class ReportService {
  private final JdbcClient jdbc;
  private final Clock clock;
  private final String zone;

  public ReportService(JdbcClient jdbc, Clock clock, HbrProperties props) {
    this.jdbc = jdbc;
    this.clock = clock;
    this.zone = props.reportZone();
  }

  /** Counts for one rack. */
  public record RackRow(UUID rackId, String rackName, long granted, long denied, long tamper, long faults) {}

  /** Counts for one day (local time). */
  public record DayRow(LocalDate day, long granted, long denied, long tamper) {}

  /** Everything on the Reports page. */
  public record Summary(int days, Instant from, Instant to, String timeZone, Map<String, Long> byType,
                        Map<String, Long> bySeverity, Map<String, Long> deniedReasons,
                        List<RackRow> byRack, List<DayRow> byDay, long activeCredentials,
                        long registeredRacks) {}

  /** Counts for the last `days` days: by type, severity, rack, day, and why cards were refused. */
  public Summary summary(int days) {
    Instant to = clock.instant();
    Instant from = to.minus(Duration.ofDays(days));
    var p = Map.<String, Object>of("from", Db.ts(from), "to", Db.ts(to), "zone", zone);

    Map<String, Long> byType = new LinkedHashMap<>();
    jdbc.sql("""
            SELECT event_type, count(*) AS n FROM security_events
            WHERE occurred_at >= :from AND occurred_at < :to GROUP BY event_type ORDER BY n DESC
            """).params(p).query(rs -> { byType.put(rs.getString(1), rs.getLong(2)); });

    Map<String, Long> bySeverity = new LinkedHashMap<>();
    jdbc.sql("""
            SELECT severity, count(*) FROM security_events
            WHERE occurred_at >= :from AND occurred_at < :to GROUP BY severity
            ORDER BY array_position(ARRAY['CRITICAL','HIGH','MEDIUM','LOW','INFO'], severity)
            """).params(p).query(rs -> { bySeverity.put(rs.getString(1), rs.getLong(2)); });

    Map<String, Long> deniedReasons = new LinkedHashMap<>();
    jdbc.sql("""
            SELECT coalesce(details->>'reason', 'UNKNOWN') AS reason, count(*) AS n FROM security_events
            WHERE event_type = 'ACCESS_DENIED' AND occurred_at >= :from AND occurred_at < :to
            GROUP BY 1 ORDER BY n DESC
            """).params(p).query(rs -> { deniedReasons.put(rs.getString(1), rs.getLong(2)); });

    // count(*) FILTER (WHERE ...) = "count only rows matching this", per group.
    List<RackRow> byRack = jdbc.sql("""
            SELECT r.id, r.name,
              count(e.id) FILTER (WHERE e.event_type = 'ACCESS_GRANTED') AS granted,
              count(e.id) FILTER (WHERE e.event_type = 'ACCESS_DENIED') AS denied,
              count(e.id) FILTER (WHERE e.event_type LIKE 'TAMPER%') AS tamper,
              count(e.id) FILTER (WHERE e.event_type = 'SENSOR_FAULT') AS faults
            FROM racks r
            LEFT JOIN security_events e ON e.rack_id = r.id AND e.occurred_at >= :from AND e.occurred_at < :to
            GROUP BY r.id, r.name ORDER BY lower(r.name)
            """).params(p)
        .query((rs, n) -> new RackRow(Db.uuid(rs, "id"), rs.getString("name"), rs.getLong("granted"),
            rs.getLong("denied"), rs.getLong("tamper"), rs.getLong("faults")))
        .list();

    // Days in local time (Blacksburg), so "today" matches the wall clock.
    List<DayRow> byDay = jdbc.sql("""
            SELECT (occurred_at AT TIME ZONE :zone)::date AS day,
              count(*) FILTER (WHERE event_type = 'ACCESS_GRANTED') AS granted,
              count(*) FILTER (WHERE event_type = 'ACCESS_DENIED') AS denied,
              count(*) FILTER (WHERE event_type LIKE 'TAMPER%') AS tamper
            FROM security_events
            WHERE occurred_at >= :from AND occurred_at < :to
            GROUP BY 1 ORDER BY 1
            """).params(p)
        .query((rs, n) -> new DayRow(rs.getObject("day", LocalDate.class), rs.getLong("granted"),
            rs.getLong("denied"), rs.getLong("tamper")))
        .list();

    long activeCredentials = jdbc.sql("""
            SELECT count(*) FROM credentials WHERE active AND revoked_at IS NULL
              AND (valid_until IS NULL OR valid_until > :to)
            """).params(p).query(Long.class).single();
    long racks = jdbc.sql("SELECT count(*) FROM racks").query(Long.class).single();

    return new Summary(days, from, to, zone, byType, bySeverity, deniedReasons, byRack, byDay,
        activeCredentials, racks);
  }
}
