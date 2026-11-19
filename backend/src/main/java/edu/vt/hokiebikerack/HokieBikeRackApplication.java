package edu.vt.hokiebikerack;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/** Backend entry point. Start here: config/SecurityConfig.java, then the feature packages. */
@SpringBootApplication
public class HokieBikeRackApplication {
  /** Starts the server (Spring Boot): the API on /api/v1, plus the website from ../frontend. */
  public static void main(String[] args) {
    SpringApplication.run(HokieBikeRackApplication.class, args);
  }
}
