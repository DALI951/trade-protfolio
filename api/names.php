<?php
// Trade Journal — persistent stock-name aliases (OCR name -> canonical name)
header('Content-Type: application/json; charset=utf-8');

const NAMES_FILE = __DIR__ . '/../data/names.json';

function read_names(): array {
    if (!file_exists(NAMES_FILE)) return [];
    $raw = @file_get_contents(NAMES_FILE);
    if ($raw === false) return [];
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}

function write_names(array $names): bool {
    $dir = dirname(NAMES_FILE);
    if (!is_dir($dir)) @mkdir($dir, 0775, true);
    $tmp = NAMES_FILE . '.tmp';
    $ok = @file_put_contents($tmp, json_encode($names, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE), LOCK_EX);
    if ($ok === false) return false;
    return @rename($tmp, NAMES_FILE);
}

$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'GET') {
    echo json_encode(read_names(), JSON_UNESCAPED_UNICODE);
    exit;
}

if ($method === 'POST') {
    $body = json_decode(file_get_contents('php://input'), true);
    if (!$body || !isset($body['names']) || !is_array($body['names'])) {
        http_response_code(400);
        echo json_encode(['ok' => false, 'error' => 'Missing names map']);
        exit;
    }
    $names = [];
    foreach ($body['names'] as $k => $v) {
        $key = preg_replace('/[^A-Z0-9 ]/i', '', $k);
        $val = trim(preg_replace('/[^A-Z0-9 \.\-\(\)]/i', '', $v));
        if ($key !== '' && $val !== '') $names[$key] = $val;
    }
    if (!write_names($names)) {
        http_response_code(500);
        echo json_encode(['ok' => false, 'error' => 'Could not write names file (permissions?)']);
        exit;
    }
    echo json_encode(['ok' => true, 'count' => count($names)]);
    exit;
}

http_response_code(405);
echo json_encode(['ok' => false, 'error' => 'Method not allowed']);