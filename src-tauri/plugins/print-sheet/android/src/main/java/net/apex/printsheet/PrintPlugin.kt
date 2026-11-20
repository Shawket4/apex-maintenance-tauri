package net.apex.printsheet

import android.app.Activity
import android.content.Context
import android.print.PrintAttributes
import android.print.PrintManager
import android.webkit.WebView
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin

@InvokeArg
class PrintArgs {
    var title: String? = null
}

/** Hands the page to Android's print screen (printers, or "Save as PDF"). */
@TauriPlugin
class PrintPlugin(private val activity: Activity) : Plugin(activity) {
    private var webView: WebView? = null

    override fun load(webView: WebView) {
        this.webView = webView
    }

    @Command
    fun print(invoke: Invoke) {
        val args = invoke.parseArgs(PrintArgs::class.java)
        val name = args.title?.takeIf { it.isNotBlank() } ?: "Apex Maintenance"
        activity.runOnUiThread {
            val view = webView
            if (view == null) {
                invoke.reject("the page is not ready to print")
                return@runOnUiThread
            }
            try {
                val manager = activity.getSystemService(Context.PRINT_SERVICE) as PrintManager
                val attributes = PrintAttributes.Builder()
                    .setMediaSize(PrintAttributes.MediaSize.ISO_A4)
                    .build()
                manager.print(name, view.createPrintDocumentAdapter(name), attributes)
                invoke.resolve()
            } catch (e: Exception) {
                invoke.reject(e.message ?: "printing is not available on this device")
            }
        }
    }
}
