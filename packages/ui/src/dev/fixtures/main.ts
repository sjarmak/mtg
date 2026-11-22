/**
 * Browser entry point for `packages/ui/fixtures.html`.
 *
 * `./FixturesApp.ts` argues what this page is for and why it is not on the
 * shell's mode switch. Nothing is fetched: every fixture is built from
 * `@mtg/dsl`'s committed example set, so the page is identical on a clean
 * checkout and on a machine where `npm run play` has staged something.
 */
import { createElement } from 'react';
import { FixturesApp } from './FixturesApp';
import { mount } from '../../mount';

mount('root', createElement(FixturesApp));
