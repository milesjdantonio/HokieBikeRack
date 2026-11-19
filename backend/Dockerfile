# The backend as a container, for Render (render.yaml at the repo root) or any Docker host.
# Build context is this folder:  docker build -t hokiebikerack-api backend
FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /src
COPY pom.xml .
RUN mvn -q -B dependency:go-offline
COPY src src
RUN mvn -q -B -DskipTests package && cp target/*.jar /app.jar

FROM eclipse-temurin:21-jre
# Render's free plan has 512 MB; let the JVM use most of it, and start a little faster.
ENV JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=75 -XX:TieredStopAtLevel=1 -XX:+UseSerialGC"
COPY --from=build /app.jar /app.jar
EXPOSE 8080
# Uses the real PostgreSQL from DB_HOST / DB_PORT / DB_NAME / DB_USERNAME / DB_PASSWORD (not "embedded").
ENTRYPOINT ["java", "-jar", "/app.jar"]
