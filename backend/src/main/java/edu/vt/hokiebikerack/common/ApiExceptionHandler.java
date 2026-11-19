package edu.vt.hokiebikerack.common;

import java.util.LinkedHashMap;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.HandlerMethodValidationException;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;

/**
 * Turns exceptions into consistent JSON errors ("Problem Details", RFC 9457):
 *   {"status":400,"title":"Bad Request","detail":"...","errors":{"field":"why"}}
 * The frontend shows `detail` to the user.
 * HIGHEST_PRECEDENCE so our handlers win over Spring's built-in ones.
 */
@RestControllerAdvice
@Order(Ordered.HIGHEST_PRECEDENCE)
public class ApiExceptionHandler {
  private static final Logger log = LoggerFactory.getLogger(ApiExceptionHandler.class);

  /** Our own ApiException: its status and message, as-is. */
  @ExceptionHandler(ApiException.class)
  public ProblemDetail handleApi(ApiException e) {
    return ProblemDetail.forStatusAndDetail(e.status(), e.getMessage());
  }

  /** @Valid failed on a request body: list each bad field. */
  @ExceptionHandler(MethodArgumentNotValidException.class)
  public ProblemDetail handleInvalid(MethodArgumentNotValidException e) {
    Map<String, String> errors = new LinkedHashMap<>();
    e.getBindingResult().getFieldErrors()
        .forEach(f -> errors.putIfAbsent(f.getField(), f.getDefaultMessage()));
    ProblemDetail pd = ProblemDetail.forStatusAndDetail(HttpStatus.BAD_REQUEST,
        "Some fields are invalid: " + String.join(", ", errors.keySet()));
    pd.setProperty("errors", errors);
    return pd;
  }

  /** @Min/@Max etc. failed on a query or path parameter. */
  @ExceptionHandler(HandlerMethodValidationException.class)
  public ProblemDetail handleMethodValidation(HandlerMethodValidationException e) {
    return ProblemDetail.forStatusAndDetail(HttpStatus.BAD_REQUEST, "Invalid request parameters");
  }

  /** Body wasn't valid JSON, or a value had the wrong type (e.g. severity "LOUD"). */
  @ExceptionHandler(HttpMessageNotReadableException.class)
  public ProblemDetail handleUnreadable(HttpMessageNotReadableException e) {
    return ProblemDetail.forStatusAndDetail(HttpStatus.BAD_REQUEST,
        "Request body is not valid JSON or has a wrong value type");
  }

  /** A parameter couldn't be converted, e.g. a rack ID that isn't a UUID. */
  @ExceptionHandler(MethodArgumentTypeMismatchException.class)
  public ProblemDetail handleTypeMismatch(MethodArgumentTypeMismatchException e) {
    return ProblemDetail.forStatusAndDetail(HttpStatus.BAD_REQUEST,
        "Parameter '" + e.getName() + "' has an invalid value");
  }

  /** A database rule was broken (e.g. duplicate unique value). */
  @ExceptionHandler(DataIntegrityViolationException.class)
  public ProblemDetail handleIntegrity(DataIntegrityViolationException e) {
    log.info("Data integrity violation: {}", e.getMostSpecificCause().getMessage());
    return ProblemDetail.forStatusAndDetail(HttpStatus.CONFLICT,
        "That conflicts with existing data (duplicate or invalid reference)");
  }
}
