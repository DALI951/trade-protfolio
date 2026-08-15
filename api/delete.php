<?php
// Trade Journal — delete a day
header('Content-Type: application/json; charset=utf-8');

const DATA_FILE = __DIR__ . '/../data/journal.json';

function read_all(): array {
    if (!file_exists(DATA_FILE)) return [];
    $raw = @file_get_contents(DATA_FILE);
    if ($raw === false) return [];
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}

function write_all(array $days): bool {
    $dir = dirname(DATA_FILE);
    if (!is_dir($dir)) @mkdir($dir, 0775, true);
    $tmp = DATA_FILE . '.tmp';
    $ok = @file_put_contents($tmp, json_encode($days, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE), LOCK_EX);
    if ($ok === false) return false;
    return @rename($tmp, DATA_FILE);
}

$body = json_decode(file_get_contents('php://input'), true);
if (!$body || !isset($body['date'])) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'Missing date']);
    exit;
}
$date = preg_replace('/[^0-9\-]/', '', $body['date']);
$days = read_all();
if (isset($days[$date])) unset($days[$date]);
if (!write_all($days)) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => 'Could not write data file']);
    exit;
}
echo json_encode(['ok' => true]);