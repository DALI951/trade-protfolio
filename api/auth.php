<?php
// Trade Journal — user accounts: register / login / logout / status
header('Content-Type: application/json; charset=utf-8');
require_once __DIR__ . '/_auth.php';

$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'GET') {
    echo json_encode(['ok' => true, 'user' => current_user()]);
    exit;
}

if ($method !== 'POST') {
    http_response_code(405);
    echo json_encode(['ok' => false, 'error' => 'Method not allowed']);
    exit;
}

$body = json_decode(file_get_contents('php://input'), true);
$body = is_array($body) ? $body : [];
$action = $body['action'] ?? '';

if ($action === 'register') {
    $user = strtolower(trim($body['username'] ?? ''));
    $pass = (string)($body['password'] ?? '');
    if (!valid_username($user)) {
        http_response_code(400);
        echo json_encode(['ok' => false, 'error' => 'Username must be 3-32 characters (letters, numbers, _ or .)']);
        exit;
    }
    if (strlen($pass) < 6) {
        http_response_code(400);
        echo json_encode(['ok' => false, 'error' => 'Password must be at least 6 characters']);
        exit;
    }
    $users = read_users();
    if (isset($users[$user])) {
        http_response_code(409);
        echo json_encode(['ok' => false, 'error' => 'Username already taken']);
        exit;
    }
    $users[$user] = ['hash' => password_hash($pass, PASSWORD_DEFAULT), 'created' => date('Y-m-d')];
    if (!write_users($users)) {
        http_response_code(500);
        echo json_encode(['ok' => false, 'error' => 'Could not write users file']);
        exit;
    }
    write_user_json($user, 'journals', []);
    write_user_json($user, 'names', []);
    login_user($user);
    echo json_encode(['ok' => true, 'user' => $user]);
    exit;
}

if ($action === 'login') {
    $user = strtolower(trim($body['username'] ?? ''));
    $pass = (string)($body['password'] ?? '');
    $users = read_users();
    if (!isset($users[$user]) || !password_verify($pass, $users[$user]['hash'])) {
        http_response_code(401);
        echo json_encode(['ok' => false, 'error' => 'Invalid username or password']);
        exit;
    }
    login_user($user);
    echo json_encode(['ok' => true, 'user' => $user]);
    exit;
}

if ($action === 'logout') {
    logout_user();
    echo json_encode(['ok' => true]);
    exit;
}

http_response_code(400);
echo json_encode(['ok' => false, 'error' => 'Unknown action']);