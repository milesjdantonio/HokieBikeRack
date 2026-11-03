#pragma once
// Fake flash file system (the firmware model). Files live in memory; the page keeps them across
// a model reboot, the same way real flash survives a power cut.
#include <stddef.h>
#include <stdint.h>

#include <string>

#include "Arduino.h"

#define FILE_READ "r"
#define FILE_WRITE "w"
#define FILE_APPEND "a"

class File : public Print {
 public:
  File() = default;
  File(const std::string &path, char mode);
  explicit operator bool() const { return open_; }
  int available();
  int read();
  size_t size();
  size_t write(uint8_t c) override;
  size_t write(const uint8_t *buffer, size_t size) override;
  using Print::write;
  void flush() override {}
  void close() { open_ = false; }
  String readString();
  String readStringUntil(char terminator);

 private:
  std::string path_;
  char mode_ = 'r';
  size_t pos_ = 0;
  bool open_ = false;
};

class LittleFSFS {
 public:
  bool begin(bool formatOnFail = false);
  File open(const char *path, const char *mode = FILE_READ);
  bool exists(const char *path);
  bool remove(const char *path);
  bool rename(const char *from, const char *to);
};
extern LittleFSFS LittleFS;
