<?php
// Shared auth + per-user storage helpers. Include from api/*.php.

const DATA_ROOT = __DIR__ . '/../data';
const USERS_FILE = DATA_ROOT . '/users.json';

function start_secure_session(): void {
    $dir = DATA_ROOT . '/sessions';
    if (!is_dir($dir)) @mkdir($dir, 0775, true);
    @session_save_path($dir);
    if (!headers_sent()) {
        session_set_cookie_params([
            'httponly' => true,
            'samesite' => 'Lax',
            'secure' => true,
        ]);
    }
    if (session_status() !== PHP_SESSION_ACTIVE) session_start();
}

function read_users(): array {
    if (!file_exists(USERS_FILE)) return [];
    $raw = @file_get_contents(USERS_FILE);
    if ($raw === false) return [];
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}

function write_users(array $users): bool {
    $dir = dirname(USERS_FILE);
    if (!is_dir($dir)) @mkdir($dir, 0775, true);
    $tmp = USERS_FILE . '.tmp';
    $ok = @file_put_contents($tmp, json_encode($users, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE), LOCK_EX);
    if ($ok === false) return false;
    return @rename($tmp, USERS_FILE);
}

function user_file(string $user, string $kind): string {
    $dir = DATA_ROOT . '/' . $kind;
    if (!is_dir($dir)) @mkdir($dir, 0775, true);
    return $dir . '/' . $user . '.json';
}

function read_user_json(string $user, string $kind): array {
    $f = user_file($user, $kind);
    if (!file_exists($f)) return [];
    $raw = @file_get_contents($f);
    if ($raw === false) return [];
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}

function write_user_json(string $user, string $kind, array $data): bool {
    $f = user_file($user, $kind);
    $tmp = $f . '.tmp';
    $ok = @file_put_contents($tmp, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE), LOCK_EX);
    if ($ok === false) return false;
    return @rename($tmp, $f);
}

function login_user(string $user): void {
    start_secure_session();
    $_SESSION['user'] = $user;
    $_SESSION['login_time'] = time();
}

function current_user(): ?string {
    start_secure_session();
    return isset($_SESSION['user']) ? (string)$_SESSION['user'] : null;
}

function logout_user(): void {
    start_secure_session();
    $_SESSION = [];
    if (ini_get('session.use_cookies')) {
        $p = session_get_cookie_params();
        setcookie(session_name(), '', time() - 42000, $p['path'], $p['domain'], $p['secure'], $p['httponly']);
    }
    session_destroy();
}

function require_auth(): string {
    $user = current_user();
    if (!$user) {
        http_response_code(401);
        echo json_encode(['ok' => false, 'error' => 'Not logged in']);
        exit;
    }
    return $user;
}

function valid_username(string $u): bool {
    return preg_match('/^[a-z0-9_.]{3,32}$/', $u) === 1;
}