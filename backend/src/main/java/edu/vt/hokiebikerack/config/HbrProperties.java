package edu.vt.hokiebikerack.config;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

/**
 * All "hbr.*" settings from application.yml, in one typed object.
 * Spring fills this in at startup; inject it anywhere you need a setting.
 */
@ConfigurationProperties(prefix = "hbr")
public record HbrProperties(
    @DefaultValue("72h") Duration snapshotValidity,
    @DefaultValue("3m") Duration deviceOnlineWindow,
    @DefaultValue("America/New_York") String reportZone,
    @DefaultValue Users users,
    @DefaultValue EmbeddedDb embeddedDb) {

  public record Users(
      @DefaultValue("admin") String adminUsername,
      @DefaultValue("") String adminPassword,
      @DefaultValue("viewer") String viewerUsername,
      @DefaultValue("") String viewerPassword) {}

  /** Settings for the built-in PostgreSQL used by the "embedded" profile and tests. */
  public record EmbeddedDb(
      @DefaultValue("") String dataDir,
      @DefaultValue("54329") int port,
      @DefaultValue("false") boolean cleanOnStart) {}
}
