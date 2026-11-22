// SPDX-License-Identifier: GPL-3.0-only
// Original companion. Forge is linked only in this separately executed JVM.

import forge.GuiDesktop;
import forge.gamemodes.limited.DraftRankCache;
import forge.gui.GuiBase;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;

/** Reads Forge's installed Limited rankings without moving their data into the host process. */
public final class ForgeDraftRankings {
    private static final String PREFIX = "@@MTG_FORGE_DRAFT_RANK@@";

    public static void main(String[] args) throws Exception {
        if (args.length != 1 || !args[0].matches("[A-Z0-9]+")) {
            throw new IllegalArgumentException("Expected one uppercase set code");
        }
        PrintStream protocolOut = System.out;
        System.setOut(System.err);
        GuiBase.setInterface(new GuiDesktop());
        try (BufferedReader input = new BufferedReader(
                new InputStreamReader(System.in, StandardCharsets.UTF_8))) {
            String name;
            int index = 0;
            while ((name = input.readLine()) != null) {
                Double ranking = DraftRankCache.getRanking(name, args[0]);
                protocolOut.println(PREFIX + index + "|" + (ranking == null ? "null" : ranking));
                index += 1;
            }
        }
        protocolOut.flush();
    }
}
