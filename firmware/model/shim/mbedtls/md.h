#pragma once
// Fake mbedTLS message digest (the firmware model): only HMAC-SHA256, which src/credential_ref.cpp
// uses. Implemented in hw.cpp from FIPS 180-4 / RFC 2104, so references match the real rack's.
#include <stddef.h>

typedef enum { MBEDTLS_MD_NONE = 0, MBEDTLS_MD_SHA256 = 6 } mbedtls_md_type_t;
typedef struct mbedtls_md_info_t {
  mbedtls_md_type_t type;
} mbedtls_md_info_t;

const mbedtls_md_info_t *mbedtls_md_info_from_type(mbedtls_md_type_t type);
int mbedtls_md_hmac(const mbedtls_md_info_t *info, const unsigned char *key, size_t keyLength,
                    const unsigned char *input, size_t inputLength, unsigned char *output);
