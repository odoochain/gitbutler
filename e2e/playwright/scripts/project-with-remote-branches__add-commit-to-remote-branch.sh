#!/bin/bash

echo "GIT CONFIG $GIT_CONFIG_GLOBAL"
echo "DATA DIR $E2E_TEST_APP_DATA_DIR"
echo "BUT $BUT"

branch_name="${1:?branch name is required}"

pushd remote-project
git checkout "$branch_name"
echo "$branch_name commit 3" >> a_file
git commit -am "$branch_name: third commit"

git checkout master
popd
