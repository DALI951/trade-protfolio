<?php
// Trade Journal — delete a day for the logged-in user
header('Content-Type: application/json; charset=utf-8');
require_once __DIR__ . '/_auth.php';

$user = require_auth();

$body = json_decode(file_get_contents('php://input'), true);
if (!$body || !isset($body['date'])) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'Missing date']);
    exit;
}
$date = preg_replace('/[^0-9\-]/', '', $body['date']);
$days = read_user_json($user, 'journals');
if (isset($days[$date])) unset($days[$date]);
if (!write_user_json($user, 'journals', $days)) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => 'Could not write data file']);
    exit;
}
echo json_encode(['ok' => true]);