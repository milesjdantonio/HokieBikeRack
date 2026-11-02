package edu.vt.hokiebikerack.config;

import edu.vt.hokiebikerack.devices.DeviceAuthService;
import edu.vt.hokiebikerack.devices.DevicePrincipal;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Logs in ESP32 devices for /api/v1/devices/{deviceId}/... requests.
 *
 * The device sends "Authorization: Bearer <token>". We check that token
 * against the device ID IN THE URL. So a token for rack A can never be used to
 * post events as rack B: the URL's device ID is just a claim, the token proves it.
 *
 * Not a @Component on purpose: Spring Boot would then also run it for every
 * request in the app. SecurityConfig adds it only to the device filter chain.
 */
public class DeviceTokenFilter extends OncePerRequestFilter {
  private static final Pattern DEVICE_PATH = Pattern.compile("^/api/v1/devices/([0-9a-fA-F-]{36})(/.*)?$");
  private final DeviceAuthService auth;

  public DeviceTokenFilter(DeviceAuthService auth) {
    this.auth = auth;
  }

  @Override
  protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
      throws ServletException, IOException {
    Optional<DevicePrincipal> device = Optional.empty();
    Matcher m = DEVICE_PATH.matcher(request.getRequestURI().substring(request.getContextPath().length()));
    String header = request.getHeader("Authorization");
    if (m.matches() && header != null && header.startsWith("Bearer ")) {
      try {
        device = auth.authenticate(UUID.fromString(m.group(1)), header.substring(7).trim());
      } catch (IllegalArgumentException badUuid) {
        device = Optional.empty();
      }
    }
    if (device.isPresent()) {
      var authentication = new UsernamePasswordAuthenticationToken(
          device.get(), null, List.of(new SimpleGrantedAuthority("ROLE_DEVICE")));
      SecurityContextHolder.getContext().setAuthentication(authentication);
    }
    // If not authenticated, the chain's rules reject it with 401 further on.
    chain.doFilter(request, response);
  }
}
