<?php
// Trade Journal — data storage (JSON file)
header('Content-Type: application/json; charset=utf-8');

const DATA_FILE = __DIR__ . '/../data/journal.json';
const ALLOWED_KEYS = [
    'valorisation', 'total_valo', 'plus_minus_value', 'disponible', 'engagee',
    'total_portefeuille', 'total_liquidite', 'liquidite_disponible',
    'liquidite_reservee', 'total_general', 'positions', 'holdings', 'stocks',
];

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

function clean_day(array $day): array {
    $out = [];
    foreach (ALLOWED_KEYS as $k) {
        if (array_key_exists($k, $day)) $out[$k] = $day[$k];
    }
    return $out;
}

$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'GET') {
    echo json_encode(read_all(), JSON_UNESCAPED_UNICODE);
    exit;
}

if ($method === 'POST') {
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
    $days = read_all();
    $days[$date] = clean_day($body['day']);
    if (!write_all($days)) {
        http_response_code(500);
        echo json_encode(['ok' => false, 'error' => 'Could not write data file (permissions?)']);
        exit;
    }
    echo json_encode(['ok' => true, 'date' => $date]);
    exit;
}

http_response_code(405);
echo json_encode(['ok' => false, 'error' => 'Method not allowed']);