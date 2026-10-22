package edu.vt.hokiebikerack;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import java.util.Map;

/** Minimal liveness endpoint for local development; reveals no configuration. */
@RestController
@RequestMapping("/api/v1")
public class HealthController {
  @GetMapping("/health")
  public Map<String, String> health() {
    return Map.of("status", "ok", "service", "hokiebikerack-api");
  }
}
