package edu.vt.hokiebikerack.common;

import org.springframework.http.HttpStatus;

/** Throw this from any service to send a clean error response (status + message). */
public class ApiException extends RuntimeException {
  private final HttpStatus status;

  public ApiException(HttpStatus status, String message) {
    super(message);
    this.status = status;
  }

  public HttpStatus status() {
    return status;
  }

  public static ApiException notFound(String what) {
    return new ApiException(HttpStatus.NOT_FOUND, what + " not found");
  }

  public static ApiException badRequest(String message) {
    return new ApiException(HttpStatus.BAD_REQUEST, message);
  }

  public static ApiException conflict(String message) {
    return new ApiException(HttpStatus.CONFLICT, message);
  }
}
