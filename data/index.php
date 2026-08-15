<?php
// deny direct web access to journal data
if (php_sapi_name() !== 'cli') {
    http_response_code(403);
    exit('Forbidden');
}