package edu.vt.hokiebikerack.credentials;

import edu.vt.hokiebikerack.credentials.CredentialModels.*;
import jakarta.validation.Valid;
import java.security.Principal;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

/** Admin API for cards. */
@RestController
@RequestMapping("/api/v1/credentials")
public class CredentialController {
  private final CredentialService credentials;
  private final AuthorizationRevision revision;

  public CredentialController(CredentialService credentials, AuthorizationRevision revision) {
    this.credentials = credentials;
    this.revision = revision;
  }

  @GetMapping
  public List<CredentialView> list() {
    return credentials.list();
  }

  /** Tapped-but-unregistered cards, for the Register button. */
  @GetMapping("/unknown")
  public List<UnknownCard> unknown() {
    return credentials.unknownCards();
  }

  @GetMapping("/revision")
  public Map<String, Long> currentRevision() {
    return Map.of("revision", revision.current());
  }

  @GetMapping("/{id}")
  public CredentialView get(@PathVariable UUID id) {
    return credentials.get(id);
  }

  @PostMapping
  @ResponseStatus(HttpStatus.CREATED)
  public CredentialView create(@Valid @RequestBody CreateCredential body, Principal user) {
    return credentials.create(body, user.getName());
  }

  @PatchMapping("/{id}")
  public CredentialView update(@PathVariable UUID id, @Valid @RequestBody UpdateCredential body, Principal user) {
    return credentials.update(id, body, user.getName());
  }

  @PostMapping("/{id}/revoke")
  public CredentialView revoke(@PathVariable UUID id, Principal user) {
    return credentials.revoke(id, user.getName());
  }
}
