<?php

$payload = file_get_contents('php://input');
$data = json_decode($payload, true);

//print_r(json_encode($data));

$out = array(
    'updates' => array(
        array('id' => '23jk3k123k1jn2k1', 'value' => 'bar'),
        array('id' => '66666k123k1jn2k1', 'value' => 'baz')
    ),
    'serverTime' => time() * 1000
);
fwrite(STDOUT, "stdout\n");
echo json_encode($out);