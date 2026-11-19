package edu.vt.hokiebikerack.common;

import org.springframework.http.HttpStatus;

/** Throw this from any service to send a clean error response (status + message). */
public class ApiException extends RuntimeException {
  private final HttpStatus status;

  public ApiException(HttpStatus status, String message) {
    super(message);
    this.status = status;
  }

  /** The HTTP status to answer with. */
  public HttpStatus status() {
    return status;
  }

  /** 404: "<what> not found". */
  public static ApiException notFound(String what) {
    return new ApiException(HttpStatus.NOT_FOUND, what + " not found");
  }

  /** 400: the request can't be done as sent (the message says why). */
  public static ApiException badRequest(String message) {
    return new ApiException(HttpStatus.BAD_REQUEST, message);
  }

  /** 409: clashes with the current state (e.g. already registered, already decided). */
  public static ApiException conflict(String message) {
    return new ApiException(HttpStatus.CONFLICT, message);
  }
}
