package edu.vt.hokiebikerack.config;

import java.time.Clock;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
@EnableConfigurationProperties(HbrProperties.class)
public class AppConfig {

  /**
   * The current time comes from this bean instead of Instant.now() everywhere,
   * so tests could swap in a fixed clock.
   */
  @Bean
  public Clock clock() {
    return Clock.systemUTC();
  }
}
