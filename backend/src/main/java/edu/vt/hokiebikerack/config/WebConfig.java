package edu.vt.hokiebikerack.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.ViewControllerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * Page addresses. Spring serves frontend/index.html (the version chooser) at "/" by itself. Each
 * version is a folder; "/admin" redirects to "/admin/" because its page loads files relative to
 * that address (../shared/...).
 */
@Configuration
public class WebConfig implements WebMvcConfigurer {
  @Override
  public void addViewControllers(ViewControllerRegistry registry) {
    // The old customer app's address now opens the rider version.
    registry.addRedirectViewController("/app", "/rider/");
    registry.addRedirectViewController("/app/", "/rider/");
    // The four versions (docs/notes/roles-plan.md), each a folder with its own index.html.
    for (String version : new String[] {"admin", "staff", "police", "rider"}) {
      registry.addRedirectViewController("/" + version, "/" + version + "/");
      registry.addViewController("/" + version + "/").setViewName("forward:/" + version + "/index.html");
    }
    registry.addRedirectViewController("/lab", "/lab/rive.html");
    // The rack model: the firmware compiled to WebAssembly (docs/notes/firmware-model.md).
    registry.addRedirectViewController("/model", "/model/");
    registry.addViewController("/model/").setViewName("forward:/model/index.html");
  }
}
