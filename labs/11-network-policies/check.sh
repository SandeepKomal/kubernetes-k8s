# shellcheck shell=bash
blocked() { ! http_ok "$@"; }
check "allow-everything is gone" absent networkpolicy/allow-everything
check "db is running" rolled_out deployment/db
check "frontend is running" rolled_out deployment/frontend
check "app=api can reach http://db" http_ok http://db app=api
check "app=web cannot reach http://db" blocked http://db app=web
check "app=web cannot reach http://frontend (default deny)" blocked http://frontend app=web
