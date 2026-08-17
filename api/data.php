<?php
// Trade Journal — read a user's journal (JSON per-user storage)
header('Content-Type: application/json; charset=utf-8');
require_once __DIR__ . '/_auth.php';

$user = require_auth();
echo json_encode(read_user_json($user, 'journals'), JSON_UNESCAPED_UNICODE);