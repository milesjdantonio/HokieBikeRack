package edu.vt.hokiebikerack.common;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.UUID;

/**
 * Small helpers for reading/writing database values.
 * The PostgreSQL JDBC driver understands OffsetDateTime (not Instant), so we
 * convert at the edges and use Instant (a point in UTC time) everywhere else.
 */
public final class Db {
  private Db() {}

  public static OffsetDateTime ts(Instant instant) {
    return instant == null ? null : OffsetDateTime.ofInstant(instant, ZoneOffset.UTC);
  }

  public static Instant instant(ResultSet rs, String column) throws SQLException {
    OffsetDateTime value = rs.getObject(column, OffsetDateTime.class);
    return value == null ? null : value.toInstant();
  }

  public static UUID uuid(ResultSet rs, String column) throws SQLException {
    return rs.getObject(column, UUID.class);
  }

  public static JsonNode json(ObjectMapper mapper, ResultSet rs, String column) throws SQLException {
    String text = rs.getString(column);
    if (text == null) return null;
    try {
      return mapper.readTree(text);
    } catch (JsonProcessingException e) {
      throw new SQLException("bad JSON in column " + column, e);
    }
  }

  public static String toJson(ObjectMapper mapper, Object value) {
    try {
      return mapper.writeValueAsString(value);
    } catch (JsonProcessingException e) {
      throw new IllegalArgumentException("cannot serialize to JSON", e);
    }
  }
}
