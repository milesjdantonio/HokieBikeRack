package edu.vt.hokiebikerack;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

/** Demo mode (no website login): pages work without a password, racks still need their tokens. */
@SpringBootTest(properties = "hbr.login-required=false")
@AutoConfigureMockMvc
@ActiveProfiles({"embedded", "test"})
class NoLoginDemoTest {
  @Autowired MockMvc mvc;

  @Test
  void websiteNeedsNoLoginButDevicesStillNeedTokens() throws Exception {
    mvc.perform(get("/api/v1/me")).andExpect(status().isOk())
        .andExpect(jsonPath("$.canEdit").value(true))
        .andExpect(jsonPath("$.loginRequired").value(false));
    mvc.perform(post("/api/v1/racks").contentType(MediaType.APPLICATION_JSON).content("{\"name\":\"No Login\"}"))
        .andExpect(status().isCreated());
    mvc.perform(get("/api/v1/devices/00000000-0000-0000-0000-000000000000/authorization-snapshot"))
        .andExpect(status().isUnauthorized());
  }
}
