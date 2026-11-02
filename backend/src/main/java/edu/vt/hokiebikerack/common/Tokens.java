package edu.vt.hokiebikerack.common;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.HexFormat;

/** Device token helpers. */
public final class Tokens {
  private static final SecureRandom RANDOM = new SecureRandom();

  private Tokens() {}

  /** 32 random bytes as URL-safe text (43 chars). Safe to paste into config.h. */
  public static String newDeviceToken() {
    byte[] bytes = new byte[32];
    RANDOM.nextBytes(bytes);
    return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
  }

  /**
   * SHA-256 of the token, as 64 hex chars. We store only this.
   *
   * <p>Why plain SHA-256 here but bcrypt for passwords? Passwords are short and
   * guessable, so they need a deliberately SLOW hash. A device token is 256
   * random bits: nobody can guess it, so a fast hash is enough and keeps every
   * device request quick.
   */
  public static String sha256Hex(String value) {
    try {
      MessageDigest md = MessageDigest.getInstance("SHA-256");
      return HexFormat.of().formatHex(md.digest(value.getBytes(StandardCharsets.UTF_8)));
    } catch (NoSuchAlgorithmException e) {
      throw new IllegalStateException(e);
    }
  }

  /** Compares in constant time, so response timing doesn't leak how much matched. */
  public static boolean constantTimeEquals(String a, String b) {
    if (a == null || b == null) return false;
    return MessageDigest.isEqual(a.getBytes(StandardCharsets.UTF_8), b.getBytes(StandardCharsets.UTF_8));
  }
}
