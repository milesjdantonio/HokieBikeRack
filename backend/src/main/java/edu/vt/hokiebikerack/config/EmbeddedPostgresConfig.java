package edu.vt.hokiebikerack.config;

import com.zaxxer.hikari.HikariDataSource;
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import javax.sql.DataSource;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;

/**
 * "embedded" profile: start a real PostgreSQL server inside this Java process,
 * so nobody has to install Postgres for development or the demo.
 *
 * Run with: mvn spring-boot:run -Dspring-boot.run.profiles=embedded
 *
 * The binaries are downloaded by Maven (io.zonky.test:embedded-postgres). Data
 * is kept in hbr.embedded-db.data-dir (default ~/.hokiebikerack/pgdata) so it
 * survives restarts. Delete that folder to start fresh.
 * This is a development convenience, NOT how you'd run a real deployment.
 */
@Configuration
@Profile("embedded")
public class EmbeddedPostgresConfig {
  private static final Logger log = LoggerFactory.getLogger(EmbeddedPostgresConfig.class);

  @Bean(destroyMethod = "close")
  public EmbeddedPostgres embeddedPostgres(HbrProperties props) throws IOException {
    HbrProperties.EmbeddedDb cfg = props.embeddedDb();
    EmbeddedPostgres.Builder builder = EmbeddedPostgres.builder()
        .setCleanDataDirectory(cfg.cleanOnStart());
    if (!cfg.dataDir().isBlank()) {
      Path dir = Path.of(cfg.dataDir()).toAbsolutePath();
      Files.createDirectories(dir.getParent());
      builder.setDataDirectory(dir);
      log.info("Embedded PostgreSQL data directory: {}", dir);
    }
    if (cfg.port() > 0) builder.setPort(cfg.port());  // 0 = pick any free port (tests)
    return builder.start();
  }

  /** A connection pool (HikariCP) on top of the embedded server. */
  @Bean
  public DataSource dataSource(EmbeddedPostgres postgres) {
    HikariDataSource ds = new HikariDataSource();
    ds.setJdbcUrl(postgres.getJdbcUrl("postgres", "postgres"));
    ds.setUsername("postgres");
    ds.setMaximumPoolSize(5);
    return ds;
  }
}
