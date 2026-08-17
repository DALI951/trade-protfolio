<?php
// Trade Journal — save a day (upsert) for the logged-in user
header('Content-Type: application/json; charset=utf-8');
require_once __DIR__ . '/_auth.php';

const ALLOWED_KEYS = [
    'valorisation', 'total_valo', 'plus_minus_value', 'disponible', 'engagee',
    'total_portefeuille', 'total_liquidite', 'liquidite_disponible',
    'liquidite_reservee', 'total_general', 'positions', 'holdings', 'stocks',
];

$user = require_auth();

$body = json_decode(file_get_contents('php://input'), true);
if (!$body || !isset($body['date']) || !isset($body['day'])) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'Missing date or day']);
    exit;
}
$date = preg_replace('/[^0-9\-]/', '', $body['date']);
if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'Invalid date']);
    exit;
}
$clean = [];
foreach (ALLOWED_KEYS as $k) {
    if (array_key_exists($k, $body['day'])) $clean[$k] = $body['day'][$k];
}
$days = read_user_json($user, 'journals');
$days[$date] = $clean;
if (!write_user_json($user, 'journals', $days)) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => 'Could not write data file (permissions?)']);
    exit;
}
echo json_encode(['ok' => true, 'date' => $date]);