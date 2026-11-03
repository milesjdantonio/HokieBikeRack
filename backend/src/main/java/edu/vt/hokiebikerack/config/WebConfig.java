package edu.vt.hokiebikerack.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.ViewControllerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * Page addresses. Spring serves frontend/index.html at "/" by itself; the customer app lives in
 * frontend/app/, so "/app" needs to be pointed at it. The trailing slash matters: the app's
 * pages load "css/app.css" relative to the address, which must be /app/css/app.css.
 */
@Configuration
public class WebConfig implements WebMvcConfigurer {
  @Override
  public void addViewControllers(ViewControllerRegistry registry) {
    registry.addRedirectViewController("/app", "/app/");
    registry.addViewController("/app/").setViewName("forward:/app/index.html");
    // The four versions (docs/notes/roles-plan.md), each a folder with its own index.html.
    for (String version : new String[] {"admin", "staff", "police", "rider"}) {
      registry.addRedirectViewController("/" + version, "/" + version + "/");
      registry.addViewController("/" + version + "/").setViewName("forward:/" + version + "/index.html");
    }
    registry.addRedirectViewController("/lab", "/lab/rive.html");
  }
}
