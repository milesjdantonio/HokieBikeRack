package edu.vt.hokiebikerack;

import edu.vt.hokiebikerack.config.HbrProperties;
import java.util.List;
import java.util.Map;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * "Who am I?" The dashboard calls this right after login to check the
 * password and decide whether to show edit buttons. (Hiding buttons is only
 * for convenience; the backend still enforces the role on every request.)
 */
@RestController
public class MeController {
  private final boolean loginRequired;

  public MeController(HbrProperties props) {
    this.loginRequired = props.loginRequired();
  }

  @GetMapping("/api/v1/me")
  public Map<String, Object> me(Authentication auth) {
    List<String> roles = auth.getAuthorities().stream()
        .map(GrantedAuthority::getAuthority)
        .map(a -> a.replaceFirst("^ROLE_", ""))
        .toList();
    // loginRequired = false: demo mode, the pages skip sign-in and hide Sign Out.
    return Map.of("username", auth.getName(), "roles", roles, "canEdit", roles.contains("ADMIN"),
        "loginRequired", loginRequired);
  }
}
