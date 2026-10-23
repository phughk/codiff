#!/usr/bin/env node

import { runSessionsCommand } from './sessions-command.js';

process.exitCode = await runSessionsCommand(process.argv.slice(2));
