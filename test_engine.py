from finsight import run_finsight_analysis

result = run_finsight_analysis("TSLA")

print(result.status)
print(result.data_quality)
print(result.final_report_text)