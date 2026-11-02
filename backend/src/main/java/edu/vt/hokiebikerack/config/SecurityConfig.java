package edu.vt.hokiebikerack.config;

import edu.vt.hokiebikerack.devices.DeviceAuthService;
import jakarta.servlet.http.HttpServletResponse;
import java.security.SecureRandom;
import java.util.Base64;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.core.userdetails.User;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.provisioning.InMemoryUserDetailsManager;
import org.springframework.security.web.AuthenticationEntryPoint;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.access.AccessDeniedHandler;
import org.springframework.security.web.authentication.AnonymousAuthenticationFilter;
import org.springframework.security.web.header.writers.ReferrerPolicyHeaderWriter;

/**
 * Who may call what. Three separate "filter chains", checked in order:
 *
 *  1. /api/v1/devices/**  -> ESP32s, with a device bearer token (DeviceTokenFilter).
 *  2. /api/**             -> people, with HTTP Basic login. GET = ADMIN or VIEWER,
 *                            anything that changes data = ADMIN only.
 *  3. everything else     -> the static dashboard files; public (they contain no data).
 *
 * Why CSRF protection is off: CSRF attacks abuse cookies the browser sends
 * automatically. We use no cookies or sessions; every request must carry an
 * Authorization header that only our own JavaScript adds. See docs/notes/backend.md.
 */
@Configuration
public class SecurityConfig {
  private static final Logger log = LoggerFactory.getLogger(SecurityConfig.class);
  private static final String MAP_HOSTS = "https://tiles.openfreemap.org https://server.arcgisonline.com";

  /** 401 as JSON, WITHOUT "WWW-Authenticate: Basic" so browsers don't pop up a login box. */
  private static final AuthenticationEntryPoint JSON_401 = (request, response, ex) ->
      writeProblem(response, 401, "Unauthorized", "Log in first (or check the device token)");

  private static final AccessDeniedHandler JSON_403 = (request, response, ex) ->
      writeProblem(response, 403, "Forbidden", "Your role can't do that (read-only viewer?)");

  private static void writeProblem(HttpServletResponse response, int status, String title, String detail)
      throws java.io.IOException {
    response.setStatus(status);
    response.setContentType(MediaType.APPLICATION_PROBLEM_JSON_VALUE);
    response.getWriter().write(
        "{\"status\":" + status + ",\"title\":\"" + title + "\",\"detail\":\"" + detail + "\"}");
  }

  @Bean
  @Order(1)
  SecurityFilterChain deviceChain(HttpSecurity http, DeviceAuthService deviceAuth) throws Exception {
    return http
        .securityMatcher("/api/v1/devices/**")
        .csrf(c -> c.disable())
        .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
        .addFilterBefore(new DeviceTokenFilter(deviceAuth), AnonymousAuthenticationFilter.class)
        .authorizeHttpRequests(a -> a.anyRequest().hasRole("DEVICE"))
        .exceptionHandling(e -> e.authenticationEntryPoint(JSON_401).accessDeniedHandler(JSON_403))
        .build();
  }

  @Bean
  @Order(2)
  SecurityFilterChain apiChain(HttpSecurity http) throws Exception {
    return http
        .securityMatcher("/api/**")
        .csrf(c -> c.disable())
        .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
        .httpBasic(b -> b.authenticationEntryPoint(JSON_401))
        .authorizeHttpRequests(a -> a
            .requestMatchers(HttpMethod.GET, "/api/v1/health").permitAll()
            .requestMatchers(HttpMethod.GET, "/api/**").hasAnyRole("ADMIN", "VIEWER")
            .anyRequest().hasRole("ADMIN"))
        .exceptionHandling(e -> e.authenticationEntryPoint(JSON_401).accessDeniedHandler(JSON_403))
        .build();
  }

  @Bean
  @Order(3)
  SecurityFilterChain staticChain(HttpSecurity http) throws Exception {
    return http
        .csrf(c -> c.disable())
        .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
        .authorizeHttpRequests(a -> a.anyRequest().permitAll())
        .headers(h -> h
            // Only load scripts/styles/images from our own server. Blocks most
            // cross-site scripting (XSS) even if some text slipped through unescaped.
            // 'wasm-unsafe-eval' lets the Rive animation runtime (WebAssembly) start; it does
            // NOT allow eval() of JavaScript strings. The rack map loads tiles from two providers
            // only (OpenFreeMap streets/buildings, Esri satellite), the same ones as Miles's
            // TerraSim; MapLibre runs its worker from this server.
            .contentSecurityPolicy(c -> c.policyDirectives(
                "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; "
                    + "connect-src 'self' " + MAP_HOSTS + "; img-src 'self' data: blob: " + MAP_HOSTS + "; "
                    + "object-src 'none'; frame-ancestors 'self'"))
            // The admin terminal shows the customer app inside a phone frame, so our own pages
            // may frame each other. Other sites still can't frame us (clickjacking).
            .frameOptions(fo -> fo.sameOrigin())
            .referrerPolicy(r -> r.policy(ReferrerPolicyHeaderWriter.ReferrerPolicy.NO_REFERRER)))
        .build();
  }

  /** bcrypt: a deliberately slow password hash, so stolen hashes are hard to crack. */
  @Bean
  PasswordEncoder passwordEncoder() {
    return new BCryptPasswordEncoder();
  }

  /**
   * Two demo accounts from environment variables. If a password isn't set, a
   * random one is generated and printed once in the log (like Spring Boot's default).
   */
  @Bean
  UserDetailsService users(HbrProperties props, PasswordEncoder encoder) {
    HbrProperties.Users u = props.users();
    String adminPassword = passwordOrRandom(u.adminPassword(), u.adminUsername(), "ADMIN_PASSWORD");
    String viewerPassword = passwordOrRandom(u.viewerPassword(), u.viewerUsername(), "VIEWER_PASSWORD");
    return new InMemoryUserDetailsManager(
        User.withUsername(u.adminUsername()).password(encoder.encode(adminPassword)).roles("ADMIN").build(),
        User.withUsername(u.viewerUsername()).password(encoder.encode(viewerPassword)).roles("VIEWER").build());
  }

  private static String passwordOrRandom(String configured, String username, String envName) {
    if (configured != null && !configured.isBlank()) return configured;
    byte[] bytes = new byte[12];
    new SecureRandom().nextBytes(bytes);
    String generated = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    log.warn("\n\n  No {} set. Generated password for '{}': {}\n  (set {} to choose your own)\n",
        envName, username, generated, envName);
    return generated;
  }
}
