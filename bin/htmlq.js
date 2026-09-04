#!/usr/bin/env node
import { main } from '../src/main.js';

process.exitCode = main(process.argv.slice(2));
