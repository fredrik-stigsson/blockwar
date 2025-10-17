![Blockwar](/logo.png)

# Blockwar

![License: MIT](https://img.shields.io/badge/license-MIT-green.svg) [![Contributions welcome](https://img.shields.io/badge/contributions-welcome-brightgreen.svg?style=flat)](https://github.com/fredrik-stigsson/blockwar/issues) ![Version 1.0.0](https://img.shields.io/badge/version-1.0.0-blue)

Drop, stack, and attack! Blockwar takes the block-stacking genre into a battle royale. Clear your lines to send garbage to opponents, but watch out—they can do the same! Collect and use devastating powerups to gain the upper hand in this frantic fight for survival.

---

## Installation
```bash
cd /var/www (if you want the service to work out of the box)
git clone https://github.com/fredrik-stigsson/blockwar.git
cd blockwar
npm install --omit=dev
```

---

## Enable service on production server
```bash
cp /var/www/blockwar/blockwar.service /etc/systemd/system/blockwar.service
systemctl daemon-reload
systemctl enable blockwar
systemctl start blockwar
```