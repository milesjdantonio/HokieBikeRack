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

  /** GET /api/v1/credentials: every card, A to Z. */
  @GetMapping
  public List<CredentialView> list() {
    return credentials.list();
  }

  /** Tapped-but-unregistered cards, for the Register button. */
  @GetMapping("/unknown")
  public List<UnknownCard> unknown() {
    return credentials.unknownCards();
  }

  /** GET /api/v1/credentials/revision: the authorization revision (goes up on every card change). */
  @GetMapping("/revision")
  public Map<String, Long> currentRevision() {
    return Map.of("revision", revision.current());
  }

  /** GET /api/v1/credentials/{id}: one card. */
  @GetMapping("/{id}")
  public CredentialView get(@PathVariable UUID id) {
    return credentials.get(id);
  }

  /** POST /api/v1/credentials: register a card (by its reference, never its raw ID). */
  @PostMapping
  @ResponseStatus(HttpStatus.CREATED)
  public CredentialView create(@Valid @RequestBody CreateCredential body, Principal user) {
    return credentials.create(body, user.getName());
  }

  /** PATCH /api/v1/credentials/{id}: rename, turn on/off, change racks or dates. */
  @PatchMapping("/{id}")
  public CredentialView update(@PathVariable UUID id, @Valid @RequestBody UpdateCredential body, Principal user) {
    return credentials.update(id, body, user.getName());
  }

  /** POST /api/v1/credentials/{id}/revoke: turn the card off for good. */
  @PostMapping("/{id}/revoke")
  public CredentialView revoke(@PathVariable UUID id, Principal user) {
    return credentials.revoke(id, user.getName());
  }
}
