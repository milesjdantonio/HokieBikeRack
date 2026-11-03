package edu.vt.hokiebikerack.config;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.List;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Demo mode only (hbr.login-required=false): a website request with no login is treated as the
 * admin, so nobody has to type a username or password during the demo. Audit entries still say
 * who did what ("admin"). Device endpoints are a separate filter chain and still need tokens.
 */
class DemoAdminFilter extends OncePerRequestFilter {
  private final String username;

  DemoAdminFilter(String username) {
    this.username = username;
  }

  @Override
  protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
      throws ServletException, IOException {
    if (SecurityContextHolder.getContext().getAuthentication() == null) {
      SecurityContextHolder.getContext().setAuthentication(UsernamePasswordAuthenticationToken.authenticated(
          username, null, List.of(new SimpleGrantedAuthority("ROLE_ADMIN"))));
    }
    chain.doFilter(request, response);
  }
}
