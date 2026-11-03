#pragma once
// Fake Arduino String (the firmware model). Same methods the real one has, backed by std::string.
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include <string>
#include <utility>

class String {
 public:
  String() = default;
  String(const char *s) : s_(s ? s : "") {}
  String(const std::string &s) : s_(s) {}
  String(char c) : s_(1, c) {}
  String(int v) : s_(std::to_string(v)) {}
  String(unsigned v) : s_(std::to_string(v)) {}
  String(long v) : s_(std::to_string(v)) {}
  String(unsigned long v) : s_(std::to_string(v)) {}

  String &operator=(const char *s) {
    s_ = s ? s : "";  // ArduinoJson assigns (const char*)0 to clear a String
    return *this;
  }

  const char *c_str() const { return s_.c_str(); }
  unsigned int length() const { return static_cast<unsigned int>(s_.size()); }
  bool isEmpty() const { return s_.empty(); }
  void reserve(unsigned int n) { s_.reserve(n); }
  char charAt(unsigned int i) const { return i < s_.size() ? s_[i] : 0; }
  char operator[](unsigned int i) const { return charAt(i); }

  bool concat(const char *s) {
    if (s) s_ += s;
    return true;
  }
  bool concat(const String &s) {
    s_ += s.s_;
    return true;
  }
  bool concat(char c) {
    s_ += c;
    return true;
  }
  String &operator+=(const char *s) { concat(s); return *this; }
  String &operator+=(const String &s) { concat(s); return *this; }
  String &operator+=(char c) { concat(c); return *this; }

  friend String operator+(const String &a, const String &b) { return String(a.s_ + b.s_); }
  friend String operator+(const String &a, const char *b) { return String(a.s_ + (b ? b : "")); }
  friend String operator+(const char *a, const String &b) { return String(std::string(a ? a : "") + b.s_); }

  bool operator==(const String &o) const { return s_ == o.s_; }
  bool operator==(const char *o) const { return s_ == (o ? o : ""); }
  bool operator!=(const String &o) const { return s_ != o.s_; }
  bool operator!=(const char *o) const { return !(*this == o); }
  bool operator<(const String &o) const { return s_ < o.s_; }

  bool startsWith(const char *p) const { return p && s_.compare(0, strlen(p), p) == 0; }
  bool endsWith(const char *p) const {
    size_t n = p ? strlen(p) : 0;
    return n <= s_.size() && s_.compare(s_.size() - n, n, p) == 0;
  }
  int indexOf(char c, unsigned int from = 0) const {
    size_t i = s_.find(c, from);
    return i == std::string::npos ? -1 : static_cast<int>(i);
  }
  String substring(unsigned int from) const { return from >= s_.size() ? String() : String(s_.substr(from)); }
  String substring(unsigned int from, unsigned int to) const {
    if (from > to) std::swap(from, to);
    if (from >= s_.size()) return String();
    return String(s_.substr(from, to - from));
  }
  void remove(unsigned int index) { if (index < s_.size()) s_.erase(index); }
  void remove(unsigned int index, unsigned int count) { if (index < s_.size()) s_.erase(index, count); }
  void trim() {
    size_t a = s_.find_first_not_of(" \t\r\n");
    if (a == std::string::npos) { s_.clear(); return; }
    size_t b = s_.find_last_not_of(" \t\r\n");
    s_ = s_.substr(a, b - a + 1);
  }
  long toInt() const { return strtol(s_.c_str(), nullptr, 10); }

  const std::string &str() const { return s_; }

 private:
  std::string s_;
};
