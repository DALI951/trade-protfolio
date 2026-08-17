<?php
// Trade Journal — per-user stock-name aliases (OCR name -> canonical name)
header('Content-Type: application/json; charset=utf-8');
require_once __DIR__ . '/_auth.php';

$user = require_auth();
$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'GET') {
    echo json_encode(read_user_json($user, 'names'), JSON_UNESCAPED_UNICODE);
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
    if (!write_user_json($user, 'names', $names)) {
        http_response_code(500);
        echo json_encode(['ok' => false, 'error' => 'Could not write names file (permissions?)']);
        exit;
    }
    echo json_encode(['ok' => true, 'count' => count($names)]);
    exit;
}

http_response_code(405);
echo json_encode(['ok' => false, 'error' => 'Method not allowed']);